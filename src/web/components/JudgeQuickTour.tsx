// src/web/components/JudgeQuickTour.tsx
import React, { useState } from "react";
import Link from "next/link";

export interface JudgeQuickTourProps {
  /** Optional callback to trigger a scenario directly from the tour (used on Inspector page) */
  onSelectScenario?: (scenarioId: "assign-memo-injection") => void;
  /** Optional callback to scroll to or highlight the firewall */
  onScrollToFirewall?: () => void;
  className?: string;
  defaultExpanded?: boolean;
}

export default function JudgeQuickTour({
  onSelectScenario,
  onScrollToFirewall,
  className = "",
  defaultExpanded = true,
}: JudgeQuickTourProps) {
  const [isExpanded, setIsExpanded] = useState<boolean>(defaultExpanded);
  const [activeStep, setActiveStep] = useState<number>(1);
  const [scenarioLaunched, setScenarioLaunched] = useState<boolean>(false);

  const handleLaunchStep1 = () => {
    if (onSelectScenario) {
      setScenarioLaunched(true);
      setActiveStep(2);
      onSelectScenario("assign-memo-injection");
    }
  };

  return (
    <div
      className={`border border-indigo-200/90 bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 text-white rounded-xl shadow-lg overflow-hidden transition-all duration-300 ${className}`}
      data-testid="judge-quick-tour"
    >
      {/* Header & Collapse Toggle */}
      <div className="p-4 flex items-center justify-between gap-3 border-b border-indigo-900/60 bg-indigo-950/40">
        <div className="flex items-center gap-2.5">
          <span className="text-xl">⚡</span>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm sm:text-base font-bold text-white tracking-wide">
                Hackathon Judge Quick-Tour
              </h2>
              <span className="px-2 py-0.5 text-[10px] font-mono font-bold bg-amber-400 text-slate-950 rounded-full shadow-xs uppercase">
                ⏱️ 45-Second Live Tour
              </span>
              <span className="px-2 py-0.5 text-[10px] font-mono bg-indigo-500/30 text-indigo-300 border border-indigo-400/40 rounded-full">
                3-Click Verification
              </span>
            </div>
            <p className="text-xs text-slate-300 mt-0.5">
              Verify SOLVul&apos;s deterministic STRS scoring, adversarial prompt neutralization &amp; TOCTOU firewall.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-indigo-900/60 hover:bg-indigo-800/80 text-indigo-200 border border-indigo-700/60 transition-colors flex items-center gap-1.5 shrink-0"
          data-testid="judge-tour-toggle"
          aria-expanded={isExpanded}
        >
          <span>{isExpanded ? "▲ Collapse Tour" : "▼ Open 45s Tour"}</span>
        </button>
      </div>

      {/* Tour Body */}
      {isExpanded && (
        <div className="p-4 sm:p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {/* Step 1 */}
            <div
              className={`p-3.5 rounded-lg border transition-all ${
                activeStep === 1
                  ? "bg-slate-800/95 border-indigo-500 ring-1 ring-indigo-500 shadow-md"
                  : "bg-slate-900/80 border-slate-800 hover:border-slate-700"
              }`}
              data-testid="judge-tour-step-1"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="px-2 py-0.5 text-[11px] font-bold bg-indigo-600 text-white rounded">
                  STEP 1 · CLICK
                </span>
                <span className="text-xs text-indigo-300 font-mono">10 Seconds</span>
              </div>
              <h3 className="text-xs sm:text-sm font-bold text-slate-100 mb-1">
                Synthesize Attack Payload
              </h3>
              <p className="text-[11px] text-slate-300 leading-relaxed mb-3">
                Select <strong className="text-amber-300">&apos;Silent Owner Reassignment + Memo Injection&apos;</strong> to build a real Devnet transaction containing a <code className="text-indigo-300">SystemProgram::Assign</code> hijack and an adversarial prompt injection in the Memo instruction.
              </p>
              {onSelectScenario ? (
                <button
                  type="button"
                  onClick={handleLaunchStep1}
                  className={`w-full py-1.5 px-3 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                    scenarioLaunched
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                      : "bg-amber-500 hover:bg-amber-600 text-slate-950 shadow-xs"
                  }`}
                  data-testid="judge-tour-step-1-btn"
                >
                  <span>{scenarioLaunched ? "✓ Payload Synthesized" : "💉 1-Click Launch Scenario 4"}</span>
                </button>
              ) : (
                <Link
                  href="/inspector"
                  className="inline-flex w-full py-1.5 px-3 text-xs font-bold rounded-md bg-amber-500 hover:bg-amber-600 text-slate-950 text-center justify-center transition-all shadow-xs"
                  data-testid="judge-tour-go-inspector"
                >
                  Open in Inspector →
                </Link>
              )}
            </div>

            {/* Step 2 */}
            <div
              className={`p-3.5 rounded-lg border transition-all ${
                activeStep === 2
                  ? "bg-slate-800/95 border-indigo-500 ring-1 ring-indigo-500 shadow-md"
                  : "bg-slate-900/80 border-slate-800 hover:border-slate-700"
              }`}
              data-testid="judge-tour-step-2"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="px-2 py-0.5 text-[11px] font-bold bg-purple-600 text-white rounded">
                  STEP 2 · INSPECT
                </span>
                <span className="text-xs text-purple-300 font-mono">20 Seconds</span>
              </div>
              <h3 className="text-xs sm:text-sm font-bold text-slate-100 mb-1">
                Inspect STRS &amp; Prompt Defense
              </h3>
              <p className="text-[11px] text-slate-300 leading-relaxed mb-2">
                Observe the deterministic findings:
              </p>
              <ul className="text-[11px] text-slate-300 space-y-1 mb-2 font-mono">
                <li className="flex items-center gap-1">
                  <span className="text-red-400">🚨 VS-06-ASSIGN</span>
                  <span>Owner Reassignment (Sev 9/10)</span>
                </li>
                <li className="flex items-center gap-1">
                  <span className="text-amber-400">🛡️ RAG Citations</span>
                  <span>Authoritative Solana Docs</span>
                </li>
                <li className="flex items-center gap-1">
                  <span className="text-emerald-400">🛡️ Prompt Guard</span>
                  <span className="text-emerald-300 font-bold">NEUTRALIZED</span>
                </li>
              </ul>
              <button
                type="button"
                onClick={() => setActiveStep(2)}
                className="w-full py-1.5 px-2 text-[11px] font-semibold rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors"
                data-testid="judge-tour-step-2-btn"
              >
                Review Findings Breakdown
              </button>
            </div>

            {/* Step 3 */}
            <div
              className={`p-3.5 rounded-lg border transition-all ${
                activeStep === 3
                  ? "bg-slate-800/95 border-indigo-500 ring-1 ring-indigo-500 shadow-md"
                  : "bg-slate-900/80 border-slate-800 hover:border-slate-700"
              }`}
              data-testid="judge-tour-step-3"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="px-2 py-0.5 text-[11px] font-bold bg-rose-600 text-white rounded">
                  STEP 3 · REJECT
                </span>
                <span className="text-xs text-rose-300 font-mono">15 Seconds</span>
              </div>
              <h3 className="text-xs sm:text-sm font-bold text-slate-100 mb-1">
                Trigger Firewall Reject Flow
              </h3>
              <p className="text-[11px] text-slate-300 leading-relaxed mb-2">
                Scroll to the <strong className="text-indigo-300">Pre-Sign Security Firewall</strong>:
              </p>
              <div className="text-[10px] bg-slate-950 p-2 rounded border border-slate-800 font-mono text-emerald-400 mb-2 truncate">
                SHA-256 Wire Fingerprint Bound
              </div>
              <p className="text-[11px] text-slate-300 leading-relaxed mb-3">
                Click <strong className="text-red-400">&apos;Reject&apos;</strong> to safely abort without invoking wallet signing, then click <strong className="text-slate-100">&apos;Export Receipt&apos;</strong> to download the verifiable audit report.
              </p>
              {onScrollToFirewall && (
                <button
                  type="button"
                  onClick={onScrollToFirewall}
                  className="w-full py-1.5 px-2 text-[11px] font-semibold rounded bg-rose-950/60 hover:bg-rose-900/80 text-rose-200 border border-rose-700/60 transition-colors"
                  data-testid="judge-tour-step-3-btn"
                >
                  Scroll to Firewall Actions ↓
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
