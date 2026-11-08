// src/web/pages/index.tsx
import type { NextPage } from "next";
import Head from "next/head";
import NavBar from "../components/NavBar";
import PhantomWalletConnector from "../components/PhantomWalletConnector";
import TransactionInput from "../components/TransactionInput";
import JudgeQuickTour from "../components/JudgeQuickTour";

const Home: NextPage = () => {
  return (
    <>
      <Head>
        <title>SOLVul — Solana Pre-Sign Security Firewall</title>
        <meta name="description" content="Phantom wallet connection and transaction validation" />
      </Head>
      <NavBar />
      <main className="flex flex-col items-center min-h-screen p-6 sm:p-8 bg-gray-50">
        <div className="w-full max-w-4xl mb-6">
          <JudgeQuickTour defaultExpanded={true} />
        </div>
        <h1 className="text-3xl font-bold mb-6">SOLVul Pre-Sign Firewall Demo</h1>
        <PhantomWalletConnector />
        <div className="my-8 w-full max-w-2xl">
          <TransactionInput />
        </div>
      </main>
    </>
  );
};

export default Home;

