// src/web/pages/index.tsx
import type { NextPage } from "next";
import Head from "next/head";
import Link from "next/link";
import NavBar from "../components/NavBar";
import PhantomWalletConnector from "../components/PhantomWalletConnector";
import TransactionInput from "../components/TransactionInput";
import JudgeQuickTour from "../components/JudgeQuickTour";

const Home: NextPage = () => {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <Head>
        <title>SOLVul — Solana Pre-Sign Security Firewall</title>
        <meta name="description" content="Phantom wallet connection and transaction validation" />
      </Head>
      <NavBar />
      <main className="flex flex-col items-center max-w-4xl w-full mx-auto p-6 sm:p-8 flex-1">
        {/* Hackathon Judge Quick-Tour Banner */}
        <div className="w-full mb-8">
          <JudgeQuickTour defaultExpanded={true} />
        </div>

        {/* Hero Section */}
        <div className="text-center max-w-2xl mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-800 border border-indigo-200 mb-4">
            <span>🛡️ Pre-Sign Transaction Firewall</span>
            <span>·</span>
            <span>Solana Devnet</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
            SOLVul Pre-Sign Firewall Demo
          </h1>
          <p className="text-sm sm:text-base text-slate-600 mt-3 leading-relaxed">
            Inspect, simulate, and deterministically score raw Solana transactions before authorization. Neutralize prompt injections and prevent unauthorized authority delegation.
          </p>
        </div>

        {/* Wallet Connection Card */}
        <div className="w-full max-w-xl mb-6 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-xs uppercase font-bold text-slate-400 tracking-wider mb-3 text-center">
            Step 1 · Wallet Session
          </h2>
          <PhantomWalletConnector />
        </div>

        {/* Transaction Input Card */}
        <div className="w-full max-w-xl mb-8 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-xs uppercase font-bold text-slate-400 tracking-wider mb-3">
            Step 2 · Raw Bytecode Inspection
          </h2>
          <TransactionInput />
        </div>

        {/* Feature Highlights Grid */}
        <div className="w-full grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-slate-200 text-center">
          <Link
            href="/inspector"
            className="p-4 rounded-xl bg-white border border-slate-200 hover:border-indigo-300 hover:shadow-sm transition-all group"
          >
            <span className="text-2xl mb-2 block">⚗️</span>
            <span className="text-sm font-bold text-slate-900 group-hover:text-indigo-600">
              Interactive Inspector
            </span>
            <p className="text-xs text-slate-500 mt-1">
              Test live attack scenarios in the scenario playground.
            </p>
          </Link>

          <Link
            href="/overview"
            className="p-4 rounded-xl bg-white border border-slate-200 hover:border-indigo-300 hover:shadow-sm transition-all group"
          >
            <span className="text-2xl mb-2 block">📊</span>
            <span className="text-sm font-bold text-slate-900 group-hover:text-indigo-600">
              Devnet Telemetry
            </span>
            <p className="text-xs text-slate-500 mt-1">
              Verify live cluster state and pre-sign fixtures.
            </p>
          </Link>

          <Link
            href="/risk-report"
            className="p-4 rounded-xl bg-white border border-slate-200 hover:border-indigo-300 hover:shadow-sm transition-all group"
          >
            <span className="text-2xl mb-2 block">🧾</span>
            <span className="text-sm font-bold text-slate-900 group-hover:text-indigo-600">
              Audit Receipts
            </span>
            <p className="text-xs text-slate-500 mt-1">
              Export cryptographic SHA-256 verification receipts.
            </p>
          </Link>
        </div>
      </main>
    </div>
  );
};

export default Home;
