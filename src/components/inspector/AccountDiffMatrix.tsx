// src/components/inspector/AccountDiffMatrix.tsx
import React, { useState } from "react";
import type { AccountStateDiff, StateDiffProvenance } from "./types";
import { computeAccountDiffMatrix } from "./accountDiffParser";
import type { DecodedTransaction } from "../../solana/transactionDecoder";
import type { SimulationResult } from "../../solana/simulateTransaction";

export interface AccountDiffMatrixProps {
  diffs?: AccountStateDiff[];
  decoded?: DecodedTransaction | null;
  simulation?: SimulationResult | null;
  className?: string;
}

const LAMPORTS_PER_SOL = 1_000_000_000;

function formatSol(lamports: number): string {
  const sol = lamports / LAMPORTS_PER_SOL;
  return `${sol.toFixed(4)} SOL`;
}

function formatDelta(delta: number): { text: string; colorClass: string } {
  if (delta === 0) {
    return { text: "0 SOL", colorClass: "text-slate-500" };
  }
  const sol = delta / LAMPORTS_PER_SOL;
  const sign = delta > 0 ? "+" : "";
  return {
    text: `${sign}${sol.toFixed(4)} SOL (${delta > 0 ? "+" : ""}${delta} lamports)`,
    colorClass: delta > 0 ? "text-emerald-700 font-bold" : "text-rose-700 font-bold",
  };
}

function truncateAddress(addr: string): string {
  if (!addr) return "";
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

export const AccountDiffMatrix: React.FC<AccountDiffMatrixProps> = ({
  diffs: propDiffs,
  decoded,
  simulation,
  className = "",
}) => {
  const [filterMutatedOnly, setFilterMutatedOnly] = useState(false);
  const diffs = propDiffs || computeAccountDiffMatrix(decoded, simulation);

  if (!diffs || diffs.length === 0) {
    return (
      <div
        className={`p-4 rounded-lg border border-slate-200 bg-slate-50 text-slate-500 text-sm ${className}`}
        data-testid="account-diff-empty"
      >
        No writable accounts or state modifications detected for this transaction.
      </div>
    );
  }

  const displayedDiffs = filterMutatedOnly
    ? diffs.filter((d) => d.isOwnerMutated || d.lamportsDelta !== 0 || d.dataLenDelta !== 0)
    : diffs;

  const mutatedOwnerCount = diffs.filter((d) => d.isOwnerMutated).length;
  const verifiedCount = diffs.filter((d) => d.provenance === "Verified via RPC Snapshot").length;
  const inferredCount = diffs.filter((d) => d.provenance === "Inferred from Static Instruction").length;

  return (
    <div
      className={`rounded-lg border border-slate-200 bg-white p-4 shadow-xs ${className}`}
      data-testid="account-diff-matrix"
    >
      {/* Header & Badges */}
      <div className="flex flex-wrap items-center justify-between pb-3 mb-3 border-b border-slate-200 gap-2">
        <div className="flex items-center gap-2">
          <span className="text-base">📊</span>
          <h3 className="font-bold text-sm text-slate-900">
            Pre/Post Account State Diff Matrix
          </h3>
          <span className="text-xs text-slate-500 font-mono">
            ({diffs.length} writable accounts)
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {mutatedOwnerCount > 0 && (
            <span
              className="px-2 py-0.5 bg-red-100 text-red-800 font-bold rounded-md border border-red-300"
              data-testid="owner-mutated-warning-pill"
            >
              🚨 {mutatedOwnerCount} Owner Mutation{mutatedOwnerCount > 1 ? "s" : ""}
            </span>
          )}
          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-800 font-medium rounded-md border border-emerald-200">
            {verifiedCount} Verified RPC
          </span>
          <span className="px-2 py-0.5 bg-amber-50 text-amber-800 font-medium rounded-md border border-amber-200">
            {inferredCount} Inferred Static
          </span>
          <button
            type="button"
            onClick={() => setFilterMutatedOnly(!filterMutatedOnly)}
            className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded border border-slate-300 transition-colors"
          >
            {filterMutatedOnly ? "Show All" : "Filter Mutated Only"}
          </button>
        </div>
      </div>

      {/* Critical Owner Mutation Alert Banner if any owner is mutated */}
      {mutatedOwnerCount > 0 && (
        <div
          className="mb-4 p-3 rounded-lg border border-red-400 bg-red-50 text-red-900 text-xs font-semibold flex items-center gap-2"
          data-testid="owner-mutation-alert-banner"
        >
          <span className="text-base">⚠️</span>
          <div>
            CRITICAL WARNING: Account owner mutation detected! One or more accounts have their program
            owner reassigned. This permanently re-delegates authority over the account data and lamports.
          </div>
        </div>
      )}

      {/* Diff Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
              <th className="py-2.5 px-3">Account & Role</th>
              <th className="py-2.5 px-3">Pre / Post Lamports (SOL)</th>
              <th className="py-2.5 px-3">Net Balance Delta</th>
              <th className="py-2.5 px-3">Pre / Post Program Owner</th>
              <th className="py-2.5 px-3">Data Length</th>
              <th className="py-2.5 px-3">Provenance Coverage</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 font-mono">
            {displayedDiffs.map((row) => {
              const deltaInfo = formatDelta(row.lamportsDelta);
              const isCrimsonOwner = row.isOwnerMutated;

              return (
                <tr
                  key={row.pubkey}
                  className={`hover:bg-slate-50/80 transition-colors ${
                    isCrimsonOwner ? "bg-red-50/50" : ""
                  }`}
                  data-testid={`diff-row-${row.pubkey}`}
                >
                  {/* Account Pubkey and Badges */}
                  <td className="py-2.5 px-3">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5">
                        <span
                          className="font-bold text-slate-800"
                          title={row.pubkey}
                        >
                          {truncateAddress(row.pubkey)}
                        </span>
                        {row.isSigner && (
                          <span className="px-1.5 py-0.2 bg-purple-100 text-purple-800 text-[10px] font-bold rounded">
                            Signer
                          </span>
                        )}
                        {row.isWritable && (
                          <span className="px-1.5 py-0.2 bg-blue-100 text-blue-800 text-[10px] font-bold rounded">
                            Writable
                          </span>
                        )}
                      </div>
                      {row.label && (
                        <span className="text-[10px] text-slate-500 font-sans">
                          {row.label}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Pre / Post Lamports */}
                  <td className="py-2.5 px-3">
                    <div className="flex flex-col text-slate-700">
                      <span>Pre: {formatSol(row.preLamports)}</span>
                      <span>Post: {formatSol(row.postLamports)}</span>
                    </div>
                  </td>

                  {/* Balance Delta */}
                  <td className="py-2.5 px-3">
                    <span className={deltaInfo.colorClass}>{deltaInfo.text}</span>
                  </td>

                  {/* Owner (Highlighted in Crimson if mutated) */}
                  <td className="py-2.5 px-3">
                    {isCrimsonOwner ? (
                      <div
                        className="p-1.5 rounded border border-red-300 bg-red-100 text-red-900 font-bold flex flex-col gap-0.5"
                        data-testid="crimson-owner-mutation"
                      >
                        <span className="text-[10px] uppercase tracking-wide text-red-700">
                          🚨 Owner Hijacked
                        </span>
                        <span>Pre: {truncateAddress(row.preOwner)}</span>
                        <span>Post: {truncateAddress(row.postOwner)}</span>
                      </div>
                    ) : (
                      <div className="text-slate-600 flex flex-col">
                        <span>{truncateAddress(row.postOwner)}</span>
                        <span className="text-[10px] text-slate-400">
                          (Unchanged)
                        </span>
                      </div>
                    )}
                  </td>

                  {/* Data Length */}
                  <td className="py-2.5 px-3 text-slate-600">
                    <div>
                      {row.postDataLen} bytes
                      {row.dataLenDelta !== 0 && (
                        <span
                          className={`ml-1 font-bold ${
                            row.dataLenDelta > 0
                              ? "text-emerald-700"
                              : "text-rose-700"
                          }`}
                        >
                          ({row.dataLenDelta > 0 ? "+" : ""}
                          {row.dataLenDelta})
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Provenance Badge */}
                  <td className="py-2.5 px-3">
                    {row.provenance === "Verified via RPC Snapshot" ? (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[10px] font-bold rounded-full border border-emerald-300"
                        data-testid="provenance-verified"
                        title="Captured from live validator RPC simulation state"
                      >
                        ✓ Verified via RPC Snapshot
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-900 text-[10px] font-bold rounded-full border border-amber-300"
                        data-testid="provenance-inferred"
                        title="Simulated RPC unavailable; calculated statically from instruction bytecode"
                      >
                        ℹ Inferred from Static Instruction
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default AccountDiffMatrix;
