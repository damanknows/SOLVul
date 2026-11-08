// src/web/components/PreSigningFlow.tsx
import { useState, useEffect } from "react";
import type { PublicKey } from "@solana/web3.js";
import { Transaction as LegacyTx, VersionedTransaction as VTx } from "@solana/web3.js";
import { decodeTransaction } from "../solana/transactionDecoder";
import { computeRiskScore } from "../solana/transactionRiskScore";
import { retrieve } from "../rag/retriever";
import generateExplanation, { Explanation } from "../gemini/explanation";
import { sha256 } from "../web/utils/crypto";

/**
 * Props for the pre‑signing component.
 * - `base64Tx`: the unsigned transaction payload (legacy or v0) encoded in base64.
 * - `onSigned`: callback receiving the signed transaction bytes after user approval.
 */
interface PreSigningFlowProps {
  base64Tx: string;
  onSigned?: (signedBase64: string) => void;
}

/**
 * Render a decision flow that:
 * 1. Decodes the transaction and runs risk scoring.
 * 2. Retrieves evidence from the security corpus.
 * 3. Generates a deterministic Gemini explanation.
 * 4. Shows the report to the user.
 * 5. Allows the user to Reject (no signing) or Approve (explicit signing).
 * 6. Binds the approved transaction to the exact payload hash.
 * 7. Does NOT auto‑broadcast.
 */
export default function PreSigningFlow({ base64Tx, onSigned }: PreSigningFlowProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [payloadHash, setPayloadHash] = useState<string | null>(null);
  const [decision, setDecision] = useState<"none" | "reject" | "approve">("none");

  // Step 1: decode, risk score and retrieve evidence
  useEffect(() => {
    async function prepare() {
      try {
        // Decode transaction (no connection needed for risk scoring)
        const decoded = await decodeTransaction(base64Tx);
        const { breakdown } = computeRiskScore(decoded);

        // Retrieve evidence (simple top‑3 retrieval) – empty array if store not loaded
        const retrieved = await retrieve("security", (global as any).vectorStore, 3);

        // Generate deterministic explanation
        const expl = generateExplanation(breakdown, retrieved);
        setExplanation(expl);

        // Compute payload hash (SHA‑256 of raw bytes)
        const raw = Buffer.from(base64Tx, "base64");
        const hashHex = await sha256(raw);
        setPayloadHash(hashHex);
      } catch (e: any) {
        setError(e?.message ?? "Failed to prepare transaction inspection");
      } finally {
        setLoading(false);
      }
    }
    prepare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base64Tx]);

  // Handler for Reject – simply clear decision and do NOT call wallet API
  const handleReject = () => {
    setDecision("reject");
  };

  // Handler for Approve – requires explicit user approval before signing
  const handleApprove = async () => {
    if (!payloadHash) return;
    setDecision("approve");
    try {
      // Convert base64 to a Transaction object (legacy or v0)
      const raw = Buffer.from(base64Tx, "base64");
      let txObj: LegacyTx | VTx;
      try {
        txObj = LegacyTx.from(raw) as LegacyTx;
      } catch (_) {
        if (typeof VTx === "undefined") {
          throw new Error("VersionedTransaction not supported by the SDK");
        }
        txObj = VTx.from(raw) as VTx;
      }

      // Request Phantom to sign – only after explicit user click
      const solana = (window as any).solana;
      if (!solana || !solana.isPhantom) {
        throw new Error("Phantom wallet not detected");
      }

      // The wallet expects a Transaction object; ensure recent blockhash is set
      if (!("recentBlockhash" in txObj) || !(txObj as any).recentBlockhash) {
        const { blockhash } = await solana.request({ method: "getLatestBlockhash" });
        (txObj as any).recentBlockhash = blockhash;
      }

      const signed = await solana.signTransaction(txObj);
      const signedBase64 = Buffer.from(signed.serialize()).toString("base64");
      // Return signed transaction via callback (do not auto‑broadcast)
      if (onSigned) onSigned(signedBase64);
    } catch (e: any) {
      setError(e?.message ?? "Signing failed");
    }
  };

  if (loading) return <div className="p-4">Loading inspection report…</div>;
  if (error) return <div className="p-4 text-red-600">Error: {error}</div>;
  if (!explanation) return null;

  return (
    <div className="p-4 border rounded bg-white shadow-md max-w-2xl mx-auto">
      <h2 className="text-xl font-bold mb-2">Inspection Report</h2>
      <p className="mb-2"><strong>Payload Hash (SHA‑256):</strong> {payloadHash}</p>
      <section className="mb-4">
        <h3 className="font-semibold">Summary</h3>
        <p>{explanation.summary}</p>
      </section>
      {explanation.findings.length > 0 && (
        <section className="mb-4">
          <h3 className="font-semibold">Findings</h3>
          <ul className="list-disc list-inside">
            {explanation.findings.map((f) => (
              <li key={f.id}>
                <strong>{f.id}</strong>: {f.description} (severity {f.severity}, confidence {f.confidence})
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="mb-4">
        <h3 className="font-semibold">Evidence</h3>
        <ul className="list-disc list-inside space-y-1">
          {explanation.evidence.map((e, idx) => (
            <li key={idx}>
              <em>{e.source}</em> – <a href={e.uri} target="_blank" rel="noreferrer" className="text-blue-600 underline">{e.uri}</a>
              <pre className="bg-gray-100 p-2 rounded overflow-x-auto text-sm mt-1">{e.snippet}</pre>
            </li>
          ))}
        </ul>
      </section>
      <section className="mb-4">
        <h3 className="font-semibold">Uncertainty & Limitations</h3>
        <p>{explanation.uncertainty}</p>
        <p>{explanation.limitations}</p>
      </section>
      {decision === "reject" ? (
        <div className="text-red-600 font-bold">Transaction rejected – signing not performed.</div>
      ) : decision === "approve" ? (
        <div className="text-green-600 font-bold">Transaction approved and signed – ready for manual broadcast.</div>
      ) : (
        <div className="flex space-x-4 mt-4">
          <button
            onClick={handleReject}
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
          >
            Reject
          </button>
          <button
            onClick={handleApprove}
            className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
          >
            Approve & Sign
          </button>
        </div>
      )}
    </div>
  );
}

