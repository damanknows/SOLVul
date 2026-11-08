// src/web/pages/settings.tsx
import type { NextPage } from "next";
import NavBar from "../components/NavBar";
import ResultCard from "../components/ResultCard";
import { useState } from "react";
import { Connection } from "@solana/web3.js";

/** Simple settings page – demo only. Allows user to view and change the RPC endpoint and risk config. */
const Settings: NextPage = () => {
  const [rpcUrl, setRpcUrl] = useState<string>("https://api.devnet.solana.com");
  const [customRpc, setCustomRpc] = useState<string>(rpcUrl);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const testConnection = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const conn = new Connection(customRpc);
      await conn.getVersion();
      setRpcUrl(customRpc);
      setMessage("Connection successful – RPC endpoint saved.");
    } catch (e: any) {
      setMessage(`Connection failed: ${e?.message ?? "unknown error"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <NavBar />
      <main className="max-w-2xl w-full mx-auto p-6 sm:p-8 flex-1">
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 mb-6 tracking-tight">Settings (Demo)</h1>
        <ResultCard title="Solana RPC Endpoint">
          <p className="text-xs text-slate-500 mb-2">Current endpoint: <code className="bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded font-mono">{rpcUrl}</code></p>
          <div className="mt-3 space-y-2">
            <input
              type="text"
              value={customRpc}
              onChange={(e) => setCustomRpc(e.target.value)}
              className="w-full p-2.5 border border-slate-300 rounded-lg font-mono text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
            <button
              onClick={testConnection}
              disabled={loading}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50"
            >
              {loading ? "Testing…" : "Save & Test"}
            </button>
            {message && (
              <p
                className={`mt-2 text-xs font-semibold p-2 rounded border ${
                  message.includes("successful")
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-red-50 text-red-700 border-red-200"
                }`}
              >
                {message}
              </p>
            )}
          </div>
        </ResultCard>
        <ResultCard title="Risk Scoring Configuration (Demo)">
          <p className="text-xs text-slate-600 leading-relaxed">
            The demo uses the built‑in default risk configuration. Adjustments can be made in the source code (<code className="font-mono bg-slate-100 text-slate-800 px-1 py-0.5 rounded">DEFAULT_RISK_CONFIG</code>).
          </p>
        </ResultCard>
      </main>
    </div>
  );
};

export default Settings;
