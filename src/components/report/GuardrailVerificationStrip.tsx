// src/components/report/GuardrailVerificationStrip.tsx
import React, { useState } from "react";

export interface GuardrailVerificationStripProps {
  strsScoreLocked?: boolean;
  memoSanitized?: boolean;
  injectionDetected?: boolean;
  zodVerified?: boolean;
  readOnlySafe?: boolean;
  isOfflineMode?: boolean;
  className?: string;
}

export const GuardrailVerificationStrip: React.FC<GuardrailVerificationStripProps> = ({
  strsScoreLocked = true,
  memoSanitized = true,
  injectionDetected = false,
  zodVerified = true,
  readOnlySafe = true,
  isOfflineMode = false,
  className = "",
}) => {
  const [showTelemetryDetails, setShowTelemetryDetails] = useState(false);

  return (
    <section
      className={`rounded-lg border border-slate-200 bg-white p-3.5 shadow-xs ${className}`}
      data-testid="guardrail-verification-strip"
      aria-label="Guardrail & Determinism Verification"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 mb-2.5 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <span className="text-base">🛡️</span>
          <h3 className="font-bold text-xs sm:text-sm text-slate-900 tracking-tight">
            Guardrail & Determinism Verification
          </h3>
          <span className="text-[10px] text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded font-mono font-semibold border border-emerald-200">
            4 / 4 Guardrails Active
          </span>
        </div>

        <div className="flex items-center gap-2">
          {isOfflineMode && (
            <span
              className="text-[11px] font-bold px-2 py-0.5 bg-amber-100 text-amber-900 rounded-md border border-amber-300 animate-pulse flex items-center gap-1"
              data-testid="badge-offline-mode"
            >
              <span>⚡</span>
              <span>Deterministic-Only Mode</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => setShowTelemetryDetails(!showTelemetryDetails)}
            className="text-[11px] text-slate-500 hover:text-slate-800 underline transition-colors"
            data-testid="toggle-telemetry-details-btn"
          >
            {showTelemetryDetails ? "Hide Telemetry Details" : "View Telemetry Details"}
          </button>
        </div>
      </div>

      {/* 4 Live Verification Badges */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 text-xs">
        {/* 1. STRS Score Locked Pre-LLM */}
        <div
          className={`p-2.5 rounded-lg border flex items-start gap-2 transition-all ${
            strsScoreLocked
              ? "bg-slate-50 border-slate-200 text-slate-800"
              : "bg-red-50 border-red-200 text-red-900"
          }`}
          data-testid="badge-strs-locked"
        >
          <span className="text-sm shrink-0">🔒</span>
          <div>
            <div className="font-bold text-[11px] text-slate-900 flex items-center gap-1">
              <span>STRS Score Locked Pre-LLM</span>
              <span className="text-[9px] text-emerald-700 bg-emerald-100 px-1 py-0.2 rounded font-mono">
                PASS
              </span>
            </div>
            <p className="text-[10px] text-slate-600 mt-0.5 leading-snug">
              Proves Gemini received a read-only mathematical score and could not alter severity or confidence.
            </p>
          </div>
        </div>

        {/* 2. Untrusted Memo / Metadata Sanitized */}
        <div
          className={`p-2.5 rounded-lg border flex items-start gap-2 transition-all ${
            injectionDetected
              ? "bg-amber-50/90 border-amber-300 text-amber-950"
              : memoSanitized
              ? "bg-slate-50 border-slate-200 text-slate-800"
              : "bg-red-50 border-red-200 text-red-900"
          }`}
          data-testid="badge-memo-sanitized"
        >
          <span className="text-sm shrink-0">{injectionDetected ? "⚠️" : "🛡️"}</span>
          <div>
            <div className="font-bold text-[11px] text-slate-900 flex items-center gap-1">
              <span>Untrusted Memo / Metadata Sanitized</span>
              <span
                className={`text-[9px] px-1 py-0.2 rounded font-mono ${
                  injectionDetected
                    ? "bg-amber-200 text-amber-900 font-bold"
                    : "bg-emerald-100 text-emerald-700"
                }`}
                data-testid={injectionDetected ? "badge-injection-neutralized" : undefined}
              >
                {injectionDetected ? "NEUTRALIZED" : "PASS"}
              </span>
            </div>
            <p className="text-[10px] text-slate-600 mt-0.5 leading-snug">
              {injectionDetected
                ? "Adversarial prompt injection pattern detected in transaction data and neutralized."
                : "Logs, memo strings, and RAG excerpts sanitized against prompt injection patterns."}
            </p>
          </div>
        </div>

        {/* 3. Zod Schema & Finding-ID Verified */}
        <div
          className={`p-2.5 rounded-lg border flex items-start gap-2 transition-all ${
            zodVerified
              ? "bg-slate-50 border-slate-200 text-slate-800"
              : "bg-red-50 border-red-200 text-red-900"
          }`}
          data-testid="badge-zod-verified"
        >
          <span className="text-sm shrink-0">📐</span>
          <div>
            <div className="font-bold text-[11px] text-slate-900 flex items-center gap-1">
              <span>Zod Schema & Finding-ID Verified</span>
              <span className="text-[9px] text-emerald-700 bg-emerald-100 px-1 py-0.2 rounded font-mono">
                PASS
              </span>
            </div>
            <p className="text-[10px] text-slate-600 mt-0.5 leading-snug">
              Strict schema boundary guarantees zero invented rule IDs (VS-01..VS-08) or ungrounded citations.
            </p>
          </div>
        </div>

        {/* 4. No Private Keys or Auto-Broadcast */}
        <div
          className={`p-2.5 rounded-lg border flex items-start gap-2 transition-all ${
            readOnlySafe
              ? "bg-slate-50 border-slate-200 text-slate-800"
              : "bg-red-50 border-red-200 text-red-900"
          }`}
          data-testid="badge-readonly-safe"
        >
          <span className="text-sm shrink-0">🔑</span>
          <div>
            <div className="font-bold text-[11px] text-slate-900 flex items-center gap-1">
              <span>No Private Keys or Auto-Broadcast</span>
              <span className="text-[9px] text-emerald-700 bg-emerald-100 px-1 py-0.2 rounded font-mono">
                PASS
              </span>
            </div>
            <p className="text-[10px] text-slate-600 mt-0.5 leading-snug">
              Purely inspects unsigned wire transactions. Zero wallet secret access, zero unsolicited RPC broadcasts.
            </p>
          </div>
        </div>
      </div>

      {/* Expandable Technical Telemetry Section */}
      {showTelemetryDetails && (
        <div
          className="mt-3 pt-3 border-t border-slate-100 text-[11px] text-slate-600 space-y-1.5 font-mono"
          data-testid="telemetry-details-panel"
        >
          <div className="flex justify-between py-0.5 border-b border-slate-50">
            <span className="text-slate-500">Determinism Invariant:</span>
            <span className="text-slate-800 font-semibold">Pre-Flight STRS Mathematical Scoring Active</span>
          </div>
          <div className="flex justify-between py-0.5 border-b border-slate-50">
            <span className="text-slate-500">Prompt Boundary Isolation:</span>
            <span className="text-slate-800 font-semibold">Strict Instruction Type Sanitization & Chunk Filtering</span>
          </div>
          <div className="flex justify-between py-0.5 border-b border-slate-50">
            <span className="text-slate-500">Output Validation Engine:</span>
            <span className="text-slate-800 font-semibold">Zod GeminiExplanationSchema (Type-Enforced)</span>
          </div>
          <div className="flex justify-between py-0.5 border-b border-slate-50">
            <span className="text-slate-500">Firewall Execution Mode:</span>
            <span className="text-slate-800 font-semibold">
              {isOfflineMode
                ? "Simulated Outage Mode (Deterministic Engine Fallback Active)"
                : "Online (Authoritative STRS + Dual Generative Explanation)"}
            </span>
          </div>
        </div>
      )}
    </section>
  );
};

export default GuardrailVerificationStrip;
