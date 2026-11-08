// src/web/pages/overview.tsx
import type { NextPage } from "next";
import Link from "next/link";
import NavBar from "../components/NavBar";
import LoadingSpinner from "../components/LoadingSpinner";
import ResultCard from "../components/ResultCard";
import JudgeQuickTour from "../components/JudgeQuickTour";
import { useEffect, useState } from "react";
import { Connection } from "@solana/web3.js";

/** Overview dashboard showing live devnet telemetry and demo capabilities */
const Overview: NextPage = () => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latestBlock, setLatestBlock] = useState<string | null>(null);

  useEffect(() => {
    async function fetchInfo() {
      try {
        const conn = new Connection("https://api.devnet.solana.com");
        const { blockhash } = await conn.getLatestBlockhash();
        setLatestBlock(blockhash);
      } catch (e: any) {
        setError(e?.message ?? "Failed to fetch overview data");
      } finally {
        setLoading(false);
      }
    }
    fetchInfo();
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <NavBar />
      <main className="max-w-4xl w-full mx-auto p-6 sm:p-8 space-y-6 flex-1">
        {/* Hackathon Judge Quick-Tour Banner */}
        <JudgeQuickTour defaultExpanded={true} />

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              Vulture‑SVM Dashboard – Overview
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Real-time Solana Devnet health, pre-sign inspection telemetry, and test fixtures.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              Devnet Online
            </span>
          </div>
        </div>

        {/* Quick KPI stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs uppercase font-bold text-slate-400 tracking-wider">Firewall Status</span>
            <p className="text-xl font-bold text-indigo-600 mt-1">Active &amp; Guarded</p>
            <p className="text-xs text-slate-500 mt-0.5">Pre-sign simulation enabled</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs uppercase font-bold text-slate-400 tracking-wider">STRS Rule Engine</span>
            <p className="text-xl font-bold text-slate-900 mt-1">Deterministic v1.0</p>
            <p className="text-xs text-slate-500 mt-0.5">8 Attack Vectors Evaluated</p>
          </div>
          <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs uppercase font-bold text-slate-400 tracking-wider">RAG Security Corpus</span>
            <p className="text-xl font-bold text-emerald-600 mt-1">Indexed &amp; Verified</p>
            <p className="text-xs text-slate-500 mt-0.5">Official Solana Foundation Docs</p>
          </div>
        </div>

        {loading && (
          <div className="bg-white p-8 rounded-xl border border-slate-200 text-center shadow-sm">
            <LoadingSpinner />
            <p className="text-xs text-slate-500 mt-2">Connecting to Solana Devnet RPC cluster…</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl text-sm">
            <strong>Connection Notice:</strong> {error}
          </div>
        )}

        {!loading && !error && (
          <div className="space-y-4">
            <ResultCard title="Latest Blockhash (Demo Fixture)">
              <div className="bg-slate-900 text-slate-100 p-3 rounded-lg font-mono text-xs sm:text-sm break-all flex items-center justify-between gap-3">
                <span className="text-emerald-400">{latestBlock}</span>
                <span className="text-[10px] uppercase font-bold bg-slate-800 text-slate-400 px-2 py-0.5 rounded shrink-0">
                  Devnet Slot
                </span>
              </div>
            </ResultCard>

            <ResultCard title="Demo Fixtures">
              <div className="space-y-3">
                <p className="text-xs text-slate-600">
                  Pre-configured transactional fixtures available for inspection:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-xs font-bold text-slate-800 block">Legacy Transfer Fixture</span>
                    <span className="text-[11px] text-slate-500">SystemProgram native transfer with memo instruction</span>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <span className="text-xs font-bold text-slate-800 block">Versioned Transaction (v0)</span>
                    <span className="text-[11px] text-slate-500">Address Lookup Tables with multi-instruction pipeline</span>
                  </div>
                </div>
              </div>
            </ResultCard>
          </div>
        )}

        {/* Quick Action Navigation Buttons */}
        <div className="pt-2 flex flex-wrap gap-3">
          <Link
            href="/inspector"
            className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold shadow-sm transition-colors flex items-center gap-2"
          >
            <span>⚗️</span>
            <span>Open Transaction Inspector →</span>
          </Link>
          <Link
            href="/risk-report"
            className="px-4 py-2.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-sm font-semibold shadow-xs transition-colors flex items-center gap-2"
          >
            <span>📊</span>
            <span>View Full Risk Report →</span>
          </Link>
        </div>
      </main>
    </div>
  );
};

export default Overview;
