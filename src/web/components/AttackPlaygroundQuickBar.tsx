// src/web/components/AttackPlaygroundQuickBar.tsx
import React, { useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import {
  ATTACK_SCENARIOS,
  generateAttackFixture,
  type AttackScenarioId,
  type AttackFixture,
} from "../../lib/solana/fixtures/attackPlayground";

interface AttackPlaygroundQuickBarProps {
  onSelectFixture: (fixture: AttackFixture) => void;
  phantomPubkey?: PublicKey | null;
  className?: string;
}

const SCENARIO_ICONS: Record<AttackScenarioId, string> = {
  "benign-transfer": "🛡️",
  "set-authority-hijack": "⚠️",
  "unlimited-approve": "🚨",
  "assign-memo-injection": "💉",
  "unknown-program": "❓",
};

export default function AttackPlaygroundQuickBar({
  onSelectFixture,
  phantomPubkey,
  className = "",
}: AttackPlaygroundQuickBarProps) {
  const [activeScenarioId, setActiveScenarioId] = useState<AttackScenarioId | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [lastGenerated, setLastGenerated] = useState<AttackFixture | null>(null);

  const handleLaunchScenario = async (scenarioId: AttackScenarioId) => {
    setActiveScenarioId(scenarioId);
    setLoading(true);
    try {
      const fixture = await generateAttackFixture(
        scenarioId,
        phantomPubkey || undefined,
      );
      setLastGenerated(fixture);
      onSelectFixture(fixture);
    } catch (err) {
      console.error("Failed to generate attack fixture:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`p-4 bg-slate-900 border border-slate-800 rounded-xl text-white shadow-md ${className}`}
      data-testid="attack-playground-quick-bar"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">⚗️</span>
          <div>
            <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
              <span>Attack Playground</span>
              <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-2 py-0.5 rounded-full font-mono uppercase tracking-wider">
                Live Devnet Synthesizer
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              One-click live payload synthesizer targeting STRS rules & prompt injection defenses
            </p>
          </div>
        </div>

        <div className="text-xs font-mono text-slate-400 flex items-center gap-2">
          {phantomPubkey ? (
            <span className="text-emerald-400 flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
              Payer: {phantomPubkey.toBase58().slice(0, 4)}…{phantomPubkey.toBase58().slice(-4)}
            </span>
          ) : (
            <span className="text-amber-400/90 flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-400"></span>
              Payer: Ephemeral Keypair
            </span>
          )}
        </div>
      </div>

      {/* 5 One-Click Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {ATTACK_SCENARIOS.map((scenario) => {
          const isSelected = activeScenarioId === scenario.id;
          const isBusy = loading && isSelected;

          return (
            <button
              key={scenario.id}
              type="button"
              onClick={() => handleLaunchScenario(scenario.id)}
              disabled={loading}
              className={`p-2.5 rounded-lg border text-left transition-all flex flex-col justify-between ${
                isSelected
                  ? "bg-indigo-950/70 border-indigo-500 ring-1 ring-indigo-500 shadow-sm"
                  : "bg-slate-800/80 border-slate-700/80 hover:bg-slate-800 hover:border-slate-600"
              } disabled:opacity-50`}
              data-testid={`quick-launch-${scenario.id}`}
            >
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm">{SCENARIO_ICONS[scenario.id]}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                      scenario.version === "v0"
                        ? "bg-purple-900/60 text-purple-300"
                        : "bg-blue-900/60 text-blue-300"
                    }`}
                  >
                    {scenario.version}
                  </span>
                </div>
                <div className="text-xs font-semibold text-slate-200 line-clamp-1">
                  {scenario.name}
                </div>
                <div className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">
                  {scenario.description}
                </div>
              </div>

              <div className="mt-2 pt-1.5 border-t border-slate-700/50 flex items-center justify-between text-[11px]">
                <span className="text-indigo-400 font-medium">
                  {isBusy ? "Synthesizing…" : "Inspect →"}
                </span>
                {isSelected && lastGenerated?.isLiveBlockhash && (
                  <span className="text-[9px] text-emerald-400 font-mono">Live RPC</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
