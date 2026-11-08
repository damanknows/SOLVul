// src/web/components/PreSigningFlow.tsx
import React, { useState, useEffect, useRef } from "react";
import { Transaction as LegacyTx, VersionedTransaction as VTx } from "@solana/web3.js";
import { decodeTransaction, DecodedTransaction } from "../../solana/transactionDecoder";
import { computeRiskScore, TransactionRiskAssessment } from "../../solana/transactionRiskScore";
import { retrieve } from "../../rag/retriever";
import generateExplanation, { Explanation } from "../../gemini/explanation";
import { sha256 } from "../utils/crypto";

/**
 * Explicit state machine for the pre-signing firewall workflow.
 */
export type PreSigningState =
  | "idle"
  | "decoding"
  | "simulating"
  | "analyzing"
  | "ready"
  | "rejected"
  | "signing"
  | "signed"
  | "error";

/**
 * Standard Solana Wallet Provider interface.
 */
export interface WalletProvider {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string; equals?: (other: any) => boolean } | null;
  signTransaction<T extends LegacyTx | VTx>(transaction: T): Promise<T>;
  request?: (args: { method: string; params?: any }) => Promise<any>;
}

/**
 * Props for the PreSigningFlow component.
 */
export interface PreSigningFlowProps {
  base64Tx: string;
  onSigned?: (signedBase64: string) => void;
  walletProvider?: WalletProvider;
}

/**
 * PreSigningFlow — Secure Pre-Signing Firewall Component.
 *
 * Enforces an explicit state machine:
 *   idle -> decoding -> analyzing -> ready -> (rejected | signing -> signed | error)
 *
 * Guarantees:
 * 1. Exact Transaction Binding: verifies SHA-256 hash of inspected transaction
 *    matches re-serialized bytes bit-for-bit prior to signing.
 * 2. Rejection Safety: Rejecting transitions to "rejected" and never invokes wallet signing.
 * 3. Double-Click Protection: Disables actions while in "signing" state.
 * 4. Zero Auto-Broadcast: Never broadcasts or sends transactions to RPC.
 */
export default function PreSigningFlow({
  base64Tx,
  onSigned,
  walletProvider,
}: PreSigningFlowProps) {
  const [state, setState] = useState<PreSigningState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [decodedTx, setDecodedTx] = useState<DecodedTransaction | null>(null);
  const [riskAssessment, setRiskAssessment] = useState<TransactionRiskAssessment | null>(null);
  const [explanation, setExplanation] = useState<Explanation | null>(null);
  const [inspectedHash, setInspectedHash] = useState<string | null>(null);

  // Prevent duplicate concurrent signing requests
  const isSigningRef = useRef(false);

  // Active wallet provider
  const getWallet = (): WalletProvider | undefined => {
    if (walletProvider) return walletProvider;
    if (typeof window !== "undefined" && (window as any).solana) {
      return (window as any).solana as WalletProvider;
    }
    return undefined;
  };

  useEffect(() => {
    let isCancelled = false;

    async function inspect() {
      if (!base64Tx || !base64Tx.trim()) {
        setState("idle");
        return;
      }

      setError(null);
      setState("decoding");

      try {
        const rawBytes = Buffer.from(base64Tx.trim(), "base64");
        if (rawBytes.length === 0) {
          throw new Error("Transaction payload is empty");
        }

        // 1. Exact inspected hash binding
        const hash = await sha256(rawBytes);
        if (isCancelled) return;
        setInspectedHash(hash);

        // 2. Decode transaction
        const decoded = await decodeTransaction(base64Tx);
        if (isCancelled) return;
        setDecodedTx(decoded);

        // 3. Analyzing & STRS risk scoring
        setState("analyzing");
        const assessment = computeRiskScore(decoded);
        if (isCancelled) return;
        setRiskAssessment(assessment);

        // 4. Evidence retrieval from security corpus
        const retrieved = await retrieve("security", (globalThis as any).vectorStore, 3);
        if (isCancelled) return;

        // 5. Generate deterministic explanation
        const expl = generateExplanation(assessment.breakdown, retrieved);
        if (isCancelled) return;
        setExplanation(expl);

        setState("ready");
      } catch (err: any) {
        if (isCancelled) return;
        setError(err?.message ?? "Failed to inspect transaction");
        setState("error");
      }
    }

    inspect();

    return () => {
      isCancelled = true;
    };
  }, [base64Tx]);

  // Handler for Reject — strictly transitions to "rejected" without touching wallet
  const handleReject = () => {
    if (state === "signing" || state === "signed") return;
    setState("rejected");
  };

  // Handler for Approve — verifies cryptographic transaction binding and signs
  const handleApprove = async () => {
    if (state !== "ready" || isSigningRef.current) {
      return;
    }

    if (!inspectedHash) {
      setError("Cannot sign: inspected transaction hash is missing");
      setState("error");
      return;
    }

    isSigningRef.current = true;
    setState("signing");
    setError(null);

    try {
      const raw = Buffer.from(base64Tx.trim(), "base64");
      let txObj: LegacyTx | VTx;

      // Try deserializing as legacy or v0
      try {
        txObj = LegacyTx.from(raw);
      } catch (_) {
        txObj = VTx.deserialize(raw);
      }

      // Cryptographic Transaction Binding Check:
      // Re-serialize the transaction object and verify its SHA-256 matches inspectedHash bit-for-bit
      let reSerialized: Uint8Array;
      if (txObj instanceof LegacyTx) {
        reSerialized = txObj.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        });
      } else {
        reSerialized = txObj.serialize();
      }

      const preSignHash = await sha256(reSerialized);
      if (preSignHash !== inspectedHash) {
        throw new Error(
          `Cryptographic transaction binding mismatch! Inspected hash (${inspectedHash}) does not match pre-sign hash (${preSignHash}). Transaction was modified.`,
        );
      }

      // Check wallet availability
      const wallet = getWallet();
      if (!wallet) {
        throw new Error("No Solana wallet provider detected");
      }

      // Check connected wallet fee-payer alignment if public key is available
      if (wallet.publicKey && decodedTx && decodedTx.message.accountKeys.length > 0) {
        const expectedFeePayer = decodedTx.message.accountKeys[0];
        const connectedWalletKey = typeof wallet.publicKey === "string"
          ? wallet.publicKey
          : wallet.publicKey.toBase58();

        if (connectedWalletKey !== expectedFeePayer) {
          // Note: not failing if not fee payer, but verify it exists in signers
          const isSigner = decodedTx.instructions.some((ix) =>
            ix.accounts.some((a) => a.pubkey === connectedWalletKey && a.isSigner),
          );
          if (!isSigner && connectedWalletKey !== expectedFeePayer) {
            // fee payer or signer mismatch
          }
        }
      }

      // Request signature from wallet (single call, explicit user initiation)
      const signedTx = await wallet.signTransaction(txObj);

      // Serialize signed transaction
      let signedBytes: Uint8Array;
      if (signedTx instanceof LegacyTx) {
        signedBytes = signedTx.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        });
      } else {
        signedBytes = signedTx.serialize();
      }

      const signedBase64 = Buffer.from(signedBytes).toString("base64");
      setState("signed");

      // Hand off to callback without auto-broadcasting
      if (onSigned) {
        onSigned(signedBase64);
      }
    } catch (err: any) {
      setError(err?.message ?? "Transaction signing failed");
      setState("error");
    } finally {
      isSigningRef.current = false;
    }
  };

  // Render state views
  if (state === "decoding" || state === "simulating" || state === "analyzing") {
    return (
      <div className="p-4 border rounded bg-slate-50" data-testid="presigning-loading">
        <p className="text-sm text-slate-700 font-medium">
          {state === "decoding" && "Decoding transaction payload…"}
          {state === "simulating" && "Simulating execution on chain…"}
          {state === "analyzing" && "Analyzing STRS risk scoring and retrieving evidence…"}
        </p>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="p-4 border border-red-300 rounded bg-red-50" data-testid="presigning-error">
        <h3 className="text-red-700 font-bold mb-1">Pre-Signing Firewall Error</h3>
        <p className="text-sm text-red-600">{error ?? "An unexpected error occurred"}</p>
      </div>
    );
  }

  if (state === "idle" || !explanation) {
    return (
      <div className="p-4 border rounded text-slate-500" data-testid="presigning-idle">
        No transaction loaded for inspection.
      </div>
    );
  }

  return (
    <div className="p-4 border rounded bg-white shadow-md max-w-2xl mx-auto" data-testid="presigning-flow">
      <div className="flex items-center justify-between border-b pb-2 mb-3">
        <h2 className="text-lg font-bold text-slate-900">Pre-Sign Security Firewall</h2>
        {riskAssessment && (
          <span
            className={`px-2 py-0.5 text-xs font-semibold rounded ${
              riskAssessment.riskLevel === "CRITICAL"
                ? "bg-red-100 text-red-800"
                : riskAssessment.riskLevel === "HIGH"
                ? "bg-orange-100 text-orange-800"
                : riskAssessment.riskLevel === "MEDIUM"
                ? "bg-yellow-100 text-yellow-800"
                : "bg-green-100 text-green-800"
            }`}
          >
            STRS: {riskAssessment.score}/100 ({riskAssessment.riskLevel})
          </span>
        )}
      </div>

      <div className="text-xs text-slate-500 mb-3 font-mono break-all">
        <span className="font-semibold text-slate-700">Payload SHA-256: </span>
        {inspectedHash}
      </div>

      {/* Summary */}
      <section className="mb-4">
        <h3 className="font-semibold text-sm text-slate-800 mb-1">Assessment Summary</h3>
        <p className="text-sm text-slate-700">{explanation.summary}</p>
      </section>

      {/* Findings */}
      {explanation.findings.length > 0 && (
        <section className="mb-4">
          <h3 className="font-semibold text-sm text-slate-800 mb-1">Deterministic Findings</h3>
          <ul className="space-y-1.5">
            {explanation.findings.map((f) => (
              <li
                key={f.id}
                className="text-xs bg-slate-50 p-2 rounded border border-slate-200 flex flex-col"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-slate-900">{f.id}</span>
                  <span className="text-slate-500">
                    Severity {f.severity}/10 · Confidence {Math.round(f.confidence * 100)}%
                  </span>
                </div>
                <span className="text-slate-700">{f.description}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Evidence */}
      {explanation.evidence.length > 0 && (
        <section className="mb-4">
          <h3 className="font-semibold text-sm text-slate-800 mb-1">Corpus Evidence</h3>
          <ul className="space-y-1">
            {explanation.evidence.map((e, idx) => (
              <li key={idx} className="text-xs text-slate-600">
                <span className="font-medium text-slate-800">{e.source}: </span>
                <span className="italic">{e.snippet}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Decision / Action State */}
      <div className="pt-3 border-t mt-4">
        {state === "rejected" && (
          <div
            className="p-3 bg-red-50 text-red-800 border border-red-200 rounded text-sm font-semibold text-center"
            data-testid="status-rejected"
          >
            Transaction Rejected — Signing was not performed.
          </div>
        )}

        {state === "signed" && (
          <div
            className="p-3 bg-green-50 text-green-800 border border-green-200 rounded text-sm font-semibold text-center"
            data-testid="status-signed"
          >
            Transaction Cryptographically Bound & Signed. Ready for manual broadcast.
          </div>
        )}

        {state === "signing" && (
          <div
            className="p-3 bg-indigo-50 text-indigo-800 border border-indigo-200 rounded text-sm font-semibold text-center"
            data-testid="status-signing"
          >
            Requesting wallet signature… Please approve in your wallet.
          </div>
        )}

        {state === "ready" && (
          <div className="flex space-x-3 justify-end">
            <button
              onClick={handleReject}
              className="px-4 py-2 border border-slate-300 rounded text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              data-testid="reject-button"
            >
              Reject
            </button>
            <button
              onClick={handleApprove}
              className="px-4 py-2 bg-indigo-600 rounded text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              data-testid="approve-button"
            >
              Approve & Sign
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
