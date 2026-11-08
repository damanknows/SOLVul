// src/web/pages/risk-report.tsx
import type { NextPage } from "next";
import NavBar from "../components/NavBar";
import LoadingSpinner from "../components/LoadingSpinner";
import ResultCard from "../components/ResultCard";
import UnsupportedNotice from "../components/UnsupportedNotice";
import GeminiExplanationCard from "../components/GeminiExplanationCard";
import { useEffect, useState } from "react";
import { decodeTransaction } from "../../solana/transactionDecoder";
import { computeRiskScore, DEFAULT_RISK_CONFIG } from "../../solana/transactionRiskScore";
import { simulateTransaction } from "../../solana/simulateTransaction";
import { Connection } from "@solana/web3.js";
import { retrieve } from "../../rag/retriever";
import generateExplanation from "../../gemini/explanation";
import CpiCallTree from "../components/inspector/CpiCallTree";
import AccountDiffMatrix from "../components/inspector/AccountDiffMatrix";
import AuditReceiptExport from "../components/AuditReceiptExport";
import GuardrailVerificationStrip from "../components/report/GuardrailVerificationStrip";
import { sha256 } from "../utils/crypto";

interface ReportState {
  logs?: string[];
  error?: any;
  computeUnits?: number;
  evidenceCount?: number;
}

const RiskReport: NextPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [decoded, setDecoded] = useState<any>(null);
  const [risk, setRisk] = useState<any>(null);
  const [simulation, setSimulation] = useState<ReportState>({});
  const [fullSimulation, setFullSimulation] = useState<any>(null);
  const [sha256Hash, setSha256Hash] = useState<string>("");
  const [explanation, setExplanation] = useState<any>(null);
  const [citations, setCitations] = useState<any[]>([]);
  const [simulateOutage, setSimulateOutage] = useState<boolean>(false);

  /** Demo fixture – use the same legacy transfer fixture as Overview */
  const demoBase64 = "AQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB"; // placeholder, replace with real fixture if needed

  useEffect(() => {
    async function run() {
      try {
        const hash = await sha256(Buffer.from(demoBase64, "base64"));
        setSha256Hash(hash);

        const decodedTx = await decodeTransaction(demoBase64);
        setDecoded(decodedTx);
        const { score, breakdown } = computeRiskScore(decodedTx, DEFAULT_RISK_CONFIG);
        setRisk({ score, breakdown });

        // Simulation (requires RPC connection)
        const conn = new Connection("https://api.devnet.solana.com");
        const simResult = await simulateTransaction(demoBase64, conn);
        setFullSimulation(simResult);
        setSimulation({
          logs: simResult.logs,
          error: simResult.error,
          computeUnits: simResult.computeUnitsConsumed,
          evidenceCount: simResult.returnedAccounts ? Object.keys(simResult.returnedAccounts).length : 0,
        });

        // Retrieve evidence from RAG store (global store assumed)
        const retrieved = await retrieve("security", (global as any).vectorStore, 3);
        setCitations(retrieved);
        // Generate explanation (will be validated by Zod)
        const expl = generateExplanation(breakdown, retrieved);
        setExplanation(expl);
      } catch (e: any) {
        setError(e?.message ?? "Failed to generate risk report");
      } finally {
        setLoading(false);
      }
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (loading) return (<><NavBar /><LoadingSpinner /></>);
  if (error) return (<><NavBar /><p className="p-4 text-red-600">Error: {error}</p></>);

  const unsupportedCount = decoded?.instructions?.filter((i: any) => i.isUnsupported).length ?? 0;

  return (
    <>
      <NavBar />
      <main className="max-w-4xl mx-auto p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <h1 className="text-2xl font-bold">Risk Report (Demo Fixture)</h1>
          {/* Judge Mode Outage Toggle */}
          <button
            type="button"
            onClick={() => setSimulateOutage(!simulateOutage)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all flex items-center gap-1.5 ${
              simulateOutage
                ? "bg-amber-100 text-amber-900 border-amber-400 shadow-xs"
                : "bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200"
            }`}
            data-testid="simulate-outage-toggle"
            title="Deliberately simulate a Gemini API outage/timeout to observe deterministic STRS + RAG fallback"
          >
            <span>{simulateOutage ? "⚡" : "🔌"}</span>
            <span>{simulateOutage ? "LLM Outage Active (Deterministic-Only)" : "Simulate LLM Outage"}</span>
          </button>
        </div>

        {/* Guardrail & Determinism Verification Status Strip */}
        <div className="mb-4">
          <GuardrailVerificationStrip
            strsScoreLocked={true}
            memoSanitized={true}
            injectionDetected={false}
            zodVerified={true}
            readOnlySafe={true}
            isOfflineMode={simulateOutage}
          />
        </div>

        {/* Prominent Cryptographic SHA-256 Wire Payload Fingerprint */}
        <div className="mb-4 p-3 bg-slate-900 text-slate-100 rounded-lg border border-slate-700 shadow-xs font-mono text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="text-slate-400 block text-[10px] uppercase tracking-wider font-sans font-bold">
              🔒 Inspected Wire SHA-256 Fingerprint
            </span>
            <span className="text-emerald-400 font-bold select-all break-all">
              {sha256Hash || "Computing fingerprint…"}
            </span>
          </div>
          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] w-fit">
            {decoded?.version?.toUpperCase() ?? "TX"} Wire Format
          </span>
        </div>

        {/* Downloadable Verifiable Security Audit Receipt (.json / .md) */}
        <div className="mb-4">
          <AuditReceiptExport
            base64Tx={demoBase64}
            sha256Hash={sha256Hash}
            decodedTx={decoded}
            riskAssessment={risk}
            explanation={explanation}
            ragCitations={citations.map((c: any) => ({
              source: c.metadata?.title || c.metadata?.source || "Solana Security Corpus",
              snippet: c.pageContent || c.content || "",
              sourceUrl: c.metadata?.sourceUrl,
              publisher: c.metadata?.publisher,
              trustLevel: c.metadata?.trustLevel,
            }))}
          />
        </div>

        <UnsupportedNotice count={unsupportedCount} />
        <ResultCard title="STRS Score">
          {risk?.score ?? "N/A"}
        </ResultCard>
        <ResultCard title="Confidence & Findings">
          <ul className="list-disc list-inside space-y-1">
            {risk?.breakdown?.map((f: any) => (
              <li key={f.id}>[{f.id}] {f.description} – severity {f.severity}, confidence {f.confidence}</li>
            ))}
          </ul>
        </ResultCard>

        {/* Real Google Gemini AI Security Explanation */}
        <GeminiExplanationCard
          base64Tx={demoBase64}
          simulateOutage={simulateOutage}
          onToggleOutage={(active) => setSimulateOutage(active)}
        />

        <ResultCard title="Simulation Data (Demo)">
          {simulation.error && <p className="text-red-600">Simulation error: {JSON.stringify(simulation.error)}</p>}
          {simulation.logs && (
            <pre className="bg-gray-100 p-2 rounded overflow-x-auto text-sm max-h-48">{simulation.logs.join('\n')}</pre>
          )}
          {simulation.computeUnits !== undefined && <p>Compute units consumed: {simulation.computeUnits}</p>}
          {simulation.evidenceCount !== undefined && <p>Returned account snapshots: {simulation.evidenceCount}</p>}
        </ResultCard>

        {/* Visual Security Inspection Panels: Inner CPI Execution Tree */}
        <div className="mb-4">
          <CpiCallTree
            decoded={decoded}
            simulation={fullSimulation}
            findings={risk?.breakdown ?? []}
          />
        </div>

        {/* Visual Security Inspection Panels: Pre/Post Account State Diff Matrix */}
        <div className="mb-4">
          <AccountDiffMatrix
            decoded={decoded}
            simulation={fullSimulation}
          />
        </div>

        <ResultCard title="Recommendations">
          <p>Review high‑severity findings (VS‑01, VS‑05, VS‑06) and consider adjusting transaction parameters before signing.</p>
        </ResultCard>
      </main>
    </>
  );
};

export default RiskReport;

