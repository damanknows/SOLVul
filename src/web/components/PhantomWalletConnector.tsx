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
    } catch (e) {
      // ignore
    }
  };

  return (
    <div className="flex flex-col items-center space-y-2 p-4 border rounded-md">
      {walletAddress ? (
        <>
          <p className="text-sm font-mono">Connected: {walletAddress.toBase58()}</p>
          <button
            onClick={disconnect}
            className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300"
          >
            Disconnect
          </button>
        </>
      ) : (
        <button
          onClick={connect}
          className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
        >
          Connect Phantom Wallet
        </button>
      )}
      {error && <p className="text-red-600 text-sm">{error}</p>}
    </div>
  );
}

