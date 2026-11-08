// src/web/pages/settings.tsx
import type { NextPage } from "next";
import NavBar from "../components/NavBar";
import LoadingSpinner from "../components/LoadingSpinner";
import ResultCard from "../components/ResultCard";
import { useEffect, useState } from "react";
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
    <>
      <NavBar />
      <main className="max-w-2xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">Settings (Demo)</h1>
        <ResultCard title="Solana RPC Endpoint">
          <p>Current endpoint: <code>{rpcUrl}</code></p>
          <div className="mt-2">
            <input
              type="text"
              value={customRpc}
              onChange={(e) => setCustomRpc(e.target.value)}
              className="w-full p-2 border rounded"
            />
            <button
              onClick={testConnection}
              disabled={loading}
              className="mt-2 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
            >
              {loading ? "Testing…" : "Save & Test"}
            </button>
            {message && <p className="mt-2 text-sm" style={{ color: message.includes('successful') ? 'green' : 'red' }}>{message}</p>}
          </div>
        </ResultCard>
        <ResultCard title="Risk Scoring Configuration (Demo)">
          <p>The demo uses the built‑in default risk configuration. Adjustments can be made in the source code (DEFAULT_RISK_CONFIG).</p>
        </ResultCard>
      </main>
    </>
  );
};

export default Settings;

