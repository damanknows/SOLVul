"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import type { PublicKey } from "@solana/web3.js";
import { Connection } from "@solana/web3.js";
import { SCENARIOS, generateFixture } from "../../lib/solana/fixtures/liveGenerator";
import type { GeneratedFixture, ScenarioId } from "../../lib/solana/fixtures/liveGenerator";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AttackPlaygroundDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onFixtureGenerated: (fixture: GeneratedFixture) => void;
  /** Connected Phantom wallet pubkey, or null if disconnected */
  phantomPubkey: PublicKey | null;
}

type CardState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success" }
  | { status: "error"; message: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEVNET_RPC = "https://api.devnet.solana.com";
const FEEDBACK_DURATION_MS = 2_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Truncate a base‑58 public key to `ABCD…WXYZ` form. */
function truncatePubkey(pubkey: PublicKey): string {
  const s = pubkey.toBase58();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Sub‑components
// ---------------------------------------------------------------------------

function VersionBadge({ version }: { version: "legacy" | "v0" }) {
  const colors =
    version === "legacy"
      ? "bg-blue-100 text-blue-700"
      : "bg-purple-100 text-purple-700";
  return (
    <span
      className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${colors}`}
    >
      {version}
    </span>
  );
}

function RuleIdPill({ ruleId }: { ruleId: string }) {
  return (
    <span className="inline-block px-2 py-0.5 bg-red-100 text-red-700 text-xs font-mono rounded-full mr-1 mb-1">
      {ruleId}
    </span>
  );
}

// ---------------------------------------------------------------------------
// ScenarioCard
// ---------------------------------------------------------------------------

interface ScenarioCardProps {
  label: string;
  description: string;
  expectedRuleIds: string[];
  version: "legacy" | "v0";
  cardState: CardState;
  onGenerate: () => void;
}

function ScenarioCard({
  label,
  description,
  expectedRuleIds,
  version,
  cardState,
  onGenerate,
}: ScenarioCardProps) {
  return (
    <div className="border rounded-lg p-4 mb-3 hover:shadow-md transition-shadow">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-1">
        <h3 className="font-bold text-sm text-gray-900 leading-tight">
          {label}
        </h3>
        <VersionBadge version={version} />
      </div>

      {/* Description */}
      <p className="text-xs text-gray-500 mb-2 leading-relaxed">
        {description}
      </p>

      {/* Expected rule pills */}
      {expectedRuleIds.length > 0 && (
        <div className="mb-3">
          <span className="text-[10px] uppercase tracking-wide text-gray-400 mr-1">
            Expected:
          </span>
          {expectedRuleIds.map((id) => (
            <RuleIdPill key={id} ruleId={id} />
          ))}
        </div>
      )}

      {/* Synthesized badge (always visible) */}
      <div className="mb-3">
        <span className="inline-block px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-medium rounded">
          🧪 Synthesized Devnet Test Fixture
        </span>
      </div>

      {/* Generate button / state feedback */}
      {cardState.status === "success" ? (
        <div className="w-full px-3 py-2 bg-green-50 text-green-700 text-sm text-center rounded font-medium">
          ✅ Generated!
        </div>
      ) : cardState.status === "error" ? (
        <div className="w-full px-3 py-2 bg-red-50 text-red-700 text-xs text-center rounded">
          ⚠️ {cardState.message}
        </div>
      ) : (
        <button
          type="button"
          disabled={cardState.status === "loading"}
          onClick={onGenerate}
          className="w-full px-3 py-2 bg-indigo-600 text-white text-sm rounded hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {cardState.status === "loading" ? (
            <span className="inline-flex items-center gap-1.5">
              <svg
                className="animate-spin h-4 w-4"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Generating…
            </span>
          ) : (
            "Generate"
          )}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AttackPlaygroundDrawer
// ---------------------------------------------------------------------------

export default function AttackPlaygroundDrawer({
  isOpen,
  onClose,
  onFixtureGenerated,
  phantomPubkey,
}: AttackPlaygroundDrawerProps) {
  // Per‑scenario card state keyed by ScenarioId
  const [cardStates, setCardStates] = useState<Record<ScenarioId, CardState>>(
    () => {
      const initial: Record<string, CardState> = {};
      for (const s of SCENARIOS) {
        initial[s.id] = { status: "idle" };
      }
      return initial as Record<ScenarioId, CardState>;
    },
  );

  // Track active feedback timers so we can clear them on unmount
  const feedbackTimers = useRef<Map<ScenarioId, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  useEffect(() => {
    return () => {
      // Cleanup all timers on unmount
      for (const t of feedbackTimers.current.values()) {
        clearTimeout(t);
      }
    };
  }, []);

  const setCardState = useCallback((id: ScenarioId, state: CardState) => {
    setCardStates((prev) => ({ ...prev, [id]: state }));
  }, []);

  const resetAfterDelay = useCallback(
    (id: ScenarioId) => {
      // Clear any existing timer for this scenario
      const existing = feedbackTimers.current.get(id);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        setCardState(id, { status: "idle" });
        feedbackTimers.current.delete(id);
      }, FEEDBACK_DURATION_MS);
      feedbackTimers.current.set(id, timer);
    },
    [setCardState],
  );

  const handleGenerate = useCallback(
    async (scenarioId: ScenarioId) => {
      setCardState(scenarioId, { status: "loading" });

      try {
        const connection = new Connection(DEVNET_RPC);
        const fixture = await generateFixture(
          scenarioId,
          connection,
          phantomPubkey ?? undefined,
        );
        onFixtureGenerated(fixture);
        setCardState(scenarioId, { status: "success" });
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Unknown error occurred";
        setCardState(scenarioId, { status: "error", message });
      }

      resetAfterDelay(scenarioId);
    },
    [phantomPubkey, onFixtureGenerated, setCardState, resetAfterDelay],
  );

  // Prevent body scroll while drawer is open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  return (
    <>
      {/* Overlay */}
      <div
        className={`fixed inset-0 bg-black/40 z-40 transition-opacity duration-300 ${
          isOpen
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <aside
        role="dialog"
        aria-label="Attack Playground"
        aria-modal="true"
        className={`fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-xl z-50 overflow-y-auto transform transition-transform duration-300 ease-in-out ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* ─── Header ─────────────────────────────────────────────── */}
        <div className="sticky top-0 bg-white border-b px-5 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg font-bold text-gray-900">
            ⚗️ Attack Playground
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded"
            aria-label="Close drawer"
          >
            ×
          </button>
        </div>

        {/* ─── Wallet status bar ──────────────────────────────────── */}
        <div className="px-5 py-3 border-b">
          {phantomPubkey ? (
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded px-3 py-2">
              <span>🔗</span>
              <span>
                Using wallet:{" "}
                <code className="font-mono text-xs">
                  {truncatePubkey(phantomPubkey)}
                </code>
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 rounded px-3 py-2">
              <span>🔑</span>
              <span>Using ephemeral keypair</span>
            </div>
          )}
        </div>

        {/* ─── Scenario cards ─────────────────────────────────────── */}
        <div className="px-5 py-4">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3 font-semibold">
            Scenarios ({SCENARIOS.length})
          </p>

          {SCENARIOS.map((scenario) => (
            <ScenarioCard
              key={scenario.id}
              label={scenario.label}
              description={scenario.description}
              expectedRuleIds={scenario.expectedRuleIds}
              version={scenario.version}
              cardState={cardStates[scenario.id]}
              onGenerate={() => handleGenerate(scenario.id)}
            />
          ))}
        </div>

        {/* ─── Footer ─────────────────────────────────────────────── */}
        <div className="px-5 py-4 border-t text-center">
          <p className="text-[10px] text-gray-400">
            Fixtures are synthesized client‑side — no real funds are involved.
          </p>
        </div>
      </aside>
    </>
  );
}
