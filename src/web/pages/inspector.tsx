// src/web/pages/inspector.tsx
import type { NextPage } from "next";
import NavBar from "../components/NavBar";
import ResultCard from "../components/ResultCard";
import PreSigningFlow from "../components/PreSigningFlow";
import AttackPlaygroundDrawer from "../components/AttackPlaygroundDrawer";
import AttackPlaygroundQuickBar from "../components/AttackPlaygroundQuickBar";
import GuardrailVerificationStrip from "../components/report/GuardrailVerificationStrip";
import JudgeQuickTour from "../components/JudgeQuickTour";
import type { GeneratedFixture } from "../../lib/solana/fixtures/liveGenerator";
import { generateAttackFixture, type AttackFixture } from "../../lib/solana/fixtures/attackPlayground";
import { useState, useEffect } from "react";
import type { PublicKey } from "@solana/web3.js";

const Inspector: NextPage = () => {
  const [txInput, setTxInput] = useState<string>("");
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [fixtureLabel, setFixtureLabel] = useState<string | null>(null);
  const [phantomPubkey, setPhantomPubkey] = useState<PublicKey | null>(null);
  const [simulateOutage, setSimulateOutage] = useState<boolean>(false);

  // Detect Phantom wallet on mount
  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).solana?.isPhantom) {
      (window as any).solana
        .connect({ onlyIfTrusted: true })
        .then((resp: any) => setPhantomPubkey(resp.publicKey))
        .catch(() => {});
    }
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (txInput.trim()) {
      setFixtureLabel(null);
      setSubmitted(true);
    }
  };

  const handleFixtureGenerated = (fixture: GeneratedFixture) => {
    setTxInput(fixture.base64Tx);
    setFixtureLabel(fixture.label);
    setSubmitted(true);
    setDrawerOpen(false);
  };

  const handleQuickFixture = (fixture: AttackFixture) => {
    setTxInput(fixture.base64Tx);
    setFixtureLabel(fixture.name);
    setSubmitted(true);
  };

  const handleTourScenario = async (scenarioId: "assign-memo-injection") => {
    try {
      const fixture = await generateAttackFixture(scenarioId, phantomPubkey || undefined);
      handleQuickFixture(fixture);
    } catch (err) {
      console.error("Failed to generate tour attack fixture:", err);
    }
  };

  const handleReset = () => {
    setTxInput("");
    setSubmitted(false);
    setFixtureLabel(null);
  };

  return (
    <>
      <NavBar />
      <main className="max-w-4xl mx-auto p-6">
        {/* Hackathon Judge Quick-Tour Banner */}
        <JudgeQuickTour
          onSelectScenario={handleTourScenario}
          className="mb-6"
        />

        {/* Interactive Attack Playground Quick-Launch Bar mounted at the top */}
        <AttackPlaygroundQuickBar
          onSelectFixture={handleQuickFixture}
          phantomPubkey={phantomPubkey}
          className="mb-6"
        />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Transaction Inspector</h1>
            <p className="text-xs text-slate-500">
              Pre-sign transaction firewall, deterministic STRS scoring & verifiable guardrails.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
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

            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="px-3 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 transition-colors flex items-center gap-1.5"
            >
              <span>⚗️</span>
              <span>Scenario Drawer</span>
            </button>
          </div>
        </div>

        {/* Guardrail & Determinism Verification Status Strip */}
        <GuardrailVerificationStrip
          isOfflineMode={simulateOutage}
          injectionDetected={Boolean(txInput && (txInput.includes("Ignore STRS") || txInput.includes("SYSTEM:")))}
          className="mb-6"
        />

        {!submitted ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <label className="block font-medium">Base64‑encoded unsigned transaction (legacy or v0)</label>
            <textarea
              value={txInput}
              onChange={(e) => setTxInput(e.target.value)}
              rows={6}
              className="w-full p-2 border rounded resize-none"
              placeholder="Enter base64 payload…"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              Inspect Transaction
            </button>
          </form>
        ) : (
          <>
            {/* Fixture badge */}
            {fixtureLabel && (
              <div
                className="mb-4 px-4 py-3 bg-amber-50/90 border border-amber-200 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-xs"
                data-testid="synthesized-fixture-badge"
              >
                <div className="flex items-center gap-2.5">
                  <span className="inline-block px-2.5 py-1 bg-amber-500 text-white text-xs font-semibold rounded-md shadow-xs">
                    🧪 Synthesized Devnet Fixture
                  </span>
                  <span className="text-sm text-amber-950 font-bold">
                    {fixtureLabel}
                  </span>
                </div>
                <span className="text-xs text-amber-800 bg-amber-100/70 px-2 py-0.5 rounded font-mono w-fit">
                  Unsigned Pre-Sign Test Payload
                </span>
              </div>
            )}
            <ResultCard title="Inspection Report">
              {/* PreSigningFlow handles loading, decoding, STRS scoring, RAG evidence and AI explanation */}
              <PreSigningFlow
                base64Tx={txInput.trim()}
                simulateOutage={simulateOutage}
              />
            </ResultCard>
            <button
              type="button"
              onClick={handleReset}
              className="mt-4 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 font-medium"
            >
              ← Inspect Another Transaction
            </button>
          </>
        )}
      </main>

      {/* Attack Playground Drawer */}
      <AttackPlaygroundDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onFixtureGenerated={handleFixtureGenerated}
        phantomPubkey={phantomPubkey}
      />
    </>
  );
};

export default Inspector;
