// src/web/pages/inspector.tsx
import type { NextPage } from "next";
import NavBar from "../components/NavBar";
import LoadingSpinner from "../components/LoadingSpinner";
import ResultCard from "../components/ResultCard";
import PreSigningFlow from "../components/PreSigningFlow";
import AttackPlaygroundDrawer from "../components/AttackPlaygroundDrawer";
import AttackPlaygroundQuickBar from "../components/AttackPlaygroundQuickBar";
import type { GeneratedFixture } from "../../lib/solana/fixtures/liveGenerator";
import type { AttackFixture } from "../../lib/solana/fixtures/attackPlayground";
import { useState, useEffect } from "react";
import type { PublicKey } from "@solana/web3.js";

const Inspector: NextPage = () => {
  const [txInput, setTxInput] = useState<string>("");
  const [submitted, setSubmitted] = useState<boolean>(false);
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);
  const [fixtureLabel, setFixtureLabel] = useState<string | null>(null);
  const [phantomPubkey, setPhantomPubkey] = useState<PublicKey | null>(null);

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

  const handleReset = () => {
    setTxInput("");
    setSubmitted(false);
    setFixtureLabel(null);
  };

  return (
    <>
      <NavBar />
      <main className="max-w-4xl mx-auto p-6">
        {/* Interactive Attack Playground Quick-Launch Bar mounted at the top */}
        <AttackPlaygroundQuickBar
          onSelectFixture={handleQuickFixture}
          phantomPubkey={phantomPubkey}
          className="mb-6"
        />

        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Transaction Inspector</h1>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="px-4 py-2 bg-amber-500 text-white text-sm rounded-lg hover:bg-amber-600 transition-colors flex items-center gap-2"
          >
            <span>⚗️</span>
            <span>Scenario Drawer</span>
          </button>
        </div>

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
              <PreSigningFlow base64Tx={txInput.trim()} />
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
