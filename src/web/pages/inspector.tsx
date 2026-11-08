// src/web/pages/inspector.tsx
import type { NextPage } from "next";
import NavBar from "../components/NavBar";
import LoadingSpinner from "../components/LoadingSpinner";
import ResultCard from "../components/ResultCard";
import PreSigningFlow from "../components/PreSigningFlow";
import AttackPlaygroundDrawer from "../components/AttackPlaygroundDrawer";
import type { GeneratedFixture } from "../../lib/solana/fixtures/liveGenerator";
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

  const handleReset = () => {
    setTxInput("");
    setSubmitted(false);
    setFixtureLabel(null);
  };

  return (
    <>
      <NavBar />
      <main className="max-w-4xl mx-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Transaction Inspector</h1>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="px-4 py-2 bg-amber-500 text-white text-sm rounded-lg hover:bg-amber-600 transition-colors flex items-center gap-2"
          >
            <span>⚗️</span>
            <span>Attack Playground</span>
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
              <div className="mb-4 px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
                <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-800 text-xs font-medium rounded">
                  🧪 Synthesized Devnet Test Fixture
                </span>
                <span className="text-sm text-amber-900 font-medium">
                  {fixtureLabel}
                </span>
              </div>
            )}
            <ResultCard title="Inspection Report">
              {/* PreSigningFlow already handles loading, errors and displays the report */}
              <PreSigningFlow base64Tx={txInput.trim()} />
            </ResultCard>
            <button
              type="button"
              onClick={handleReset}
              className="mt-4 px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
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
