// src/web/components/GeminiExplanationCard.tsx
import React, { useState, useEffect } from "react";
import type { GeminiAnalysisInput, GeminiExplanation } from "../../gemini/types";

interface GeminiExplanationCardProps {
  base64Tx?: string;
  inspection?: GeminiAnalysisInput;
  initialExplanation?: GeminiExplanation | null;
  simulateOutage?: boolean;
  onToggleOutage?: (active: boolean) => void;
}

export default function GeminiExplanationCard({
  base64Tx,
  inspection,
  initialExplanation = null,
  simulateOutage = false,
  onToggleOutage,
}: GeminiExplanationCardProps) {
  const [explanation, setExplanation] = useState<GeminiExplanation | null>(initialExplanation);
  const [outageMode, setOutageMode] = useState<boolean>(Boolean(simulateOutage));
  const [findingEvidence, setFindingEvidence] = useState<any[]>([]);
  const [ragSummary, setRagSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!initialExplanation);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (simulateOutage !== undefined) {
      setOutageMode(simulateOutage);
    }
  }, [simulateOutage]);

  const fetchExplanation = async () => {
    if (!base64Tx && !inspection) return;

    setLoading(true);
    setError(null);

    try {
      const payload: any = base64Tx ? { base64Tx } : { inspection };
      if (outageMode) {
        payload.simulateOutage = true;
      }

      const res = await fetch("/api/gemini/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || `HTTP ${res.status}: Failed to generate explanation`);
      }

      const data = await res.json();
      if (data.explanation) {
        setExplanation(data.explanation);
        if (Array.isArray(data.findingEvidence)) {
          setFindingEvidence(data.findingEvidence);
        }
        if (data.ragSummary) {
          setRagSummary(data.ragSummary);
        }
      } else {
        throw new Error("Invalid response format from explanation API");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load Gemini security explanation");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!initialExplanation && (base64Tx || inspection)) {
      fetchExplanation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base64Tx, outageMode]);

  if (loading) {
    return (
      <div className="p-4 border border-indigo-100 rounded-lg bg-indigo-50/50 my-4" data-testid="gemini-loading">
        <div className="flex items-center space-x-3">
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>
          <div>
            <h4 className="text-sm font-semibold text-indigo-900">Generating AI Security Explanation…</h4>
            <p className="text-xs text-indigo-700">Google Gemini is analyzing deterministic STRS inspection data.</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 border border-red-200 rounded-lg bg-red-50 my-4" data-testid="gemini-error">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-red-800">Gemini Explanation Error</h4>
            <p className="text-xs text-red-600">{error}</p>
          </div>
          <button
            onClick={fetchExplanation}
            className="px-3 py-1.5 text-xs bg-red-600 text-white rounded hover:bg-red-700 font-medium"
            data-testid="gemini-retry-button"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!explanation) return null;

  return (
    <div
      className="p-5 border border-slate-200 rounded-xl bg-white shadow-sm my-4"
      data-testid="gemini-explanation-card"
    >
      {/* Header with Mode Badge */}
      <div className="flex items-center justify-between border-b pb-3 mb-4">
        <div>
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <span>🛡️</span> Security Analysis & Plain-English Explanation
          </h3>
          <p className="text-xs text-slate-500">
            Grounding deterministic STRS evidence with generative explanation. STRS findings remain authoritative.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Judge Mode Outage Toggle inside Card */}
          <button
            type="button"
            onClick={() => {
              const next = !outageMode;
              setOutageMode(next);
              if (onToggleOutage) onToggleOutage(next);
            }}
            className={`px-2.5 py-1 text-xs font-semibold rounded-full border transition-all flex items-center gap-1 ${
              outageMode
                ? "bg-amber-100 text-amber-900 border-amber-300"
                : "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200"
            }`}
            data-testid="toggle-outage-btn"
            title="Deliberately simulate a Gemini API outage/timeout to test deterministic STRS + RAG fallback"
          >
            <span>{outageMode ? "⚡" : "🔌"}</span>
            <span>{outageMode ? "LLM Outage Active" : "Simulate Outage"}</span>
          </button>

          {!explanation.isFallback && !outageMode ? (
            <span
              className="px-2.5 py-1 text-xs font-semibold bg-violet-100 text-violet-800 rounded-full border border-violet-200"
              data-testid="badge-ai-mode"
            >
              ✨ Powered by Gemini ({explanation.modelUsed || "active model"})
            </span>
          ) : (
            <span
              className="px-2.5 py-1 text-xs font-semibold bg-slate-100 text-slate-700 rounded-full border border-slate-300"
              data-testid="badge-fallback-mode"
            >
              ⚙️ Deterministic Fallback Mode
            </span>
          )}
          <button
            onClick={fetchExplanation}
            title="Refresh explanation"
            className="p-1 text-slate-400 hover:text-slate-600 rounded"
          >
            🔄
          </button>
        </div>
      </div>

      {/* Disagreements Notice (if Gemini attempted to alter findings) */}
      {explanation.disagreementsWithSTRS && explanation.disagreementsWithSTRS.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          <strong className="block mb-1">Authoritative STRS Consistency Override:</strong>
          <ul className="list-disc list-inside">
            {explanation.disagreementsWithSTRS.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Transaction Summary */}
      <section className="mb-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">What this transaction does</h4>
        <p className="text-sm text-slate-800 font-medium">{explanation.transactionSummary}</p>
      </section>

      {/* Risk Explanation */}
      <section className="mb-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Risk Assessment Details</h4>
        <p className="text-sm text-slate-700 leading-relaxed">{explanation.riskExplanation}</p>
      </section>

      {/* Critical Findings */}
      {explanation.criticalFindings.length > 0 && (
        <section className="mb-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Important Findings</h4>
          <div className="space-y-2">
            {explanation.criticalFindings.map((cf, idx) => (
              <div key={idx} className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-slate-900">{cf.ruleId}</span>
                  {cf.evidenceReferenceIds.length > 0 && (
                    <span className="text-indigo-600 font-mono text-[10px]">
                      Ref: {cf.evidenceReferenceIds.join(", ")}
                    </span>
                  )}
                </div>
                <p className="text-slate-700">{cf.explanation}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Security Concerns & Affected Assets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        {/* Security Concerns */}
        {explanation.securityConcerns.length > 0 && (
          <div className="p-3 bg-red-50/60 border border-red-100 rounded-lg">
            <h4 className="text-xs font-bold text-red-900 mb-1.5 flex items-center gap-1">
              <span>⚠️</span> Potential Security Concerns
            </h4>
            <ul className="space-y-1">
              {explanation.securityConcerns.map((concern, idx) => (
                <li key={idx} className="text-xs text-red-800 list-disc list-inside">
                  {concern}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Affected Assets */}
        {explanation.affectedAssets.length > 0 && (
          <div className="p-3 bg-amber-50/60 border border-amber-100 rounded-lg">
            <h4 className="text-xs font-bold text-amber-900 mb-1.5 flex items-center gap-1">
              <span>💼</span> Potentially Affected Assets & Accounts
            </h4>
            <ul className="space-y-1">
              {explanation.affectedAssets.map((asset, idx) => (
                <li key={idx} className="text-xs text-amber-800 list-disc list-inside font-mono">
                  {asset}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Recommended Verification Actions */}
      {explanation.recommendedActions.length > 0 && (
        <section className="mb-4 p-3 bg-emerald-50 border border-emerald-100 rounded-lg">
          <h4 className="text-xs font-bold text-emerald-900 mb-1.5 flex items-center gap-1">
            <span>✅</span> Recommended Actions Before Signing
          </h4>
          <ul className="space-y-1">
            {explanation.recommendedActions.map((action, idx) => (
              <li key={idx} className="text-xs text-emerald-800 list-disc list-inside">
                {action}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Simulation Interpretation */}
      <section className="mb-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1">Simulation Interpretation</h4>
        <p className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded border">{explanation.simulationInterpretation}</p>
      </section>

      {/* RAG Security Evidence Section */}
      <section className="mb-4 p-3.5 bg-slate-50 border border-slate-200 rounded-lg" data-testid="rag-evidence-section">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
            <span>📚</span> Retrieved Security Knowledge (RAG)
          </h4>
          <span className="text-[11px] font-mono text-slate-500">
            {findingEvidence.length > 0
              ? `${findingEvidence.reduce((acc, f) => acc + (f.documents?.length || 0), 0)} sources`
              : "0 sources"}
          </span>
        </div>

        {findingEvidence.length > 0 ? (
          <div className="space-y-3">
            {findingEvidence.map((group, gIdx) => (
              <div key={gIdx} className="border-l-2 border-indigo-400 pl-2.5 py-0.5">
                <div className="text-[11px] font-bold text-indigo-900 mb-1">
                  Supports Finding:{" "}
                  <span className="font-mono bg-indigo-100 text-indigo-800 px-1 py-0.5 rounded text-[10px]">
                    {group.findingId}
                  </span>
                </div>
                {group.documents?.map((doc: any, dIdx: number) => (
                  <div key={dIdx} className="text-xs bg-white p-2.5 rounded border border-slate-200 mb-1.5 shadow-xs">
                    <div className="flex items-center justify-between mb-1">
                      {doc.sourceUrl ? (
                        <a
                          href={doc.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-indigo-600 hover:underline flex items-center gap-1"
                        >
                          {doc.title} ↗
                        </a>
                      ) : (
                        <span className="font-semibold text-slate-800">{doc.title}</span>
                      )}
                      <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                        Retrieval Relevance: {typeof doc.relevanceScore === "number" ? `${(doc.relevanceScore * 100).toFixed(0)}%` : "N/A"}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 line-clamp-3 italic">
                      "{doc.excerpt}"
                    </p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500 italic">
            {ragSummary || "No sufficiently relevant security documentation found."}
          </p>
        )}
      </section>

      {/* Evidence References */}
      {explanation.evidenceReferences.length > 0 && (
        <section className="mb-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-1.5">Corpus References</h4>
          <div className="space-y-1">
            {explanation.evidenceReferences.map((ref, idx) => (
              <div key={idx} className="text-xs text-slate-600 flex items-start gap-1.5">
                <span className="font-mono text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded text-[10px]">
                  {ref.documentId}
                </span>
                <span>{ref.reason}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Limitations & Uncertainties */}
      {explanation.limitations.length > 0 && (
        <div className="pt-2 border-t text-[11px] text-slate-500">
          <span className="font-semibold text-slate-600">Remaining Limitations: </span>
          {explanation.limitations.join(" · ")}
        </div>
      )}
    </div>
  );
}
