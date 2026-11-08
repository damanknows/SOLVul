// src/web/components/PhantomWalletConnector.tsx
import { useEffect, useState } from "react";
import type { PublicKey } from "@solana/web3.js";

/**
 * Simple Phantom wallet connector for Solana Devnet.
 *
 * - Does **not** request private keys or seed phrases.
 * - Only obtains the public address after user approval.
 */
export default function PhantomWalletConnector() {
  const [walletAddress, setWalletAddress] = useState<PublicKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Detect Phantom on load
  useEffect(() => {
    if (typeof window !== "undefined" && (window as any).solana?.isPhantom) {
      // automatically try to connect if already trusted
      (window as any).solana.connect({ onlyIfTrusted: true })
        .then((resp: any) => setWalletAddress(resp.publicKey))
        .catch(() => {});
    }
  }, []);

  const connect = async () => {
    try {
      const resp = await (window as any).solana.connect();
      setWalletAddress(resp.publicKey);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Failed to connect wallet");
    }
  };

  const disconnect = async () => {
    try {
      await (window as any).solana.disconnect();
      setWalletAddress(null);
    } catch {
      // ignore
    }
  };

  return (
    <div className="flex flex-col items-center space-y-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
      {walletAddress ? (
        <div className="flex flex-col sm:flex-row items-center gap-3 w-full justify-between bg-white p-3 rounded-lg border border-slate-200">
          <div className="flex items-center gap-2 overflow-hidden">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0"></span>
            <span className="text-xs text-slate-500 font-medium">Connected:</span>
            <span className="text-xs font-mono font-bold text-slate-800 truncate max-w-[200px] sm:max-w-[260px]">
              {walletAddress.toBase58()}
            </span>
          </div>
          <button
            onClick={disconnect}
            className="px-3 py-1 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md border border-slate-300 transition-colors"
          >
            Disconnect
          </button>
        </div>
      ) : (
        <button
          onClick={connect}
          className="px-5 py-2.5 bg-gradient-to-r from-purple-600 via-indigo-600 to-indigo-700 hover:from-purple-700 hover:to-indigo-800 text-white text-sm font-semibold rounded-xl shadow-sm transition-all duration-150 flex items-center gap-2"
        >
          <span>👻</span>
          <span>Connect Phantom Wallet</span>
        </button>
      )}
      {error && <p className="text-red-600 text-xs font-medium">{error}</p>}
    </div>
  );
}
