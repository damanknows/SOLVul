// src/web/pages/overview.tsx
import type { NextPage } from "next";
import NavBar from "../components/NavBar";
import LoadingSpinner from "../components/LoadingSpinner";
import ResultCard from "../components/ResultCard";
import { useEffect, useState } from "react";
import { Connection } from "@solana/web3.js";

/** Simple placeholder overview showing demo fixture counts */
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
    <>
      <NavBar />
      <main className="max-w-4xl mx-auto p-6">
        <h1 className="text-2xl font-bold mb-4">Vulture‑SVM Dashboard – Overview</h1>
        {loading && <LoadingSpinner />}
        {error && <p className="text-red-600">Error: {error}</p>}
        {!loading && !error && (
          <>
            <ResultCard title="Latest Blockhash (Demo Fixture)">
              {latestBlock}
            </ResultCard>
            <ResultCard title="Demo Fixtures">
              <ul className="list-disc list-inside">
                <li>Legacy transfer fixture (assets/solana-docs/…)</li>
                <li>Versioned transaction fixture (generated on‑the‑fly)</li>
              </ul>
            </ResultCard>
          </>
        )}
      </main>
    </>
  );
};

export default Overview;

