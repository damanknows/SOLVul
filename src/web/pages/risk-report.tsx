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

  /** Demo fixture – use the same legacy transfer fixture as Overview */
  const demoBase64 = "AQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB"; // placeholder, replace with real fixture if needed

  useEffect(() => {
    async function run() {
      try {
        const decodedTx = await decodeTransaction(demoBase64);
        setDecoded(decodedTx);
        const { score, breakdown } = computeRiskScore(decodedTx, DEFAULT_RISK_CONFIG);
        setRisk({ score, breakdown });

        // Simulation (requires RPC connection)
        const conn = new Connection("https://api.devnet.solana.com");
        const simResult = await simulateTransaction(demoBase64, conn);
        setSimulation({
          logs: simResult.logs,
          error: simResult.error,
          computeUnits: simResult.computeUnitsConsumed,
          evidenceCount: simResult.returnedAccounts ? Object.keys(simResult.returnedAccounts).length : 0,
        });

        // Retrieve evidence from RAG store (global store assumed)
        const retrieved = await retrieve("security", (global as any).vectorStore, 3);
        // Generate explanation (will be validated by Zod)
        generateExplanation(breakdown, retrieved);
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
        <h1 className="text-2xl font-bold mb-4">Risk Report (Demo Fixture)</h1>
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
        <GeminiExplanationCard base64Tx={demoBase64} />

        <ResultCard title="Simulation Data (Demo)">
          {simulation.error && <p className="text-red-600">Simulation error: {JSON.stringify(simulation.error)}</p>}
          {simulation.logs && (
            <pre className="bg-gray-100 p-2 rounded overflow-x-auto text-sm max-h-48">{simulation.logs.join('\n')}</pre>
          )}
          {simulation.computeUnits !== undefined && <p>Compute units consumed: {simulation.computeUnits}</p>}
          {simulation.evidenceCount !== undefined && <p>Returned account snapshots: {simulation.evidenceCount}</p>}
        </ResultCard>
        <ResultCard title="Recommendations">
          <p>Review high‑severity findings (VS‑01, VS‑05, VS‑06) and consider adjusting transaction parameters before signing.</p>
        </ResultCard>
      </main>
    </>
  );
};

export default RiskReport;

