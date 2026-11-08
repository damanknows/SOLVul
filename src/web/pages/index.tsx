// src/web/pages/index.tsx
import type { NextPage } from "next";
import Head from "next/head";
import PhantomWalletConnector from "../components/PhantomWalletConnector";
import TransactionInput from "../components/TransactionInput";

const Home: NextPage = () => {
  return (
    <>
      <Head>
        <title>Vulture‑SVM Demo</title>
        <meta name="description" content="Phantom wallet connection and transaction validation" />
      </Head>
      <main className="flex flex-col items-center min-h-screen p-8 bg-gray-50">
        <h1 className="text-3xl font-bold mb-6">Vulture‑SVM Wallet &amp; Payload Demo</h1>
        <PhantomWalletConnector />
        <div className="my-8 w-full max-w-2xl">
          <TransactionInput />
        </div>
      </main>
    </>
  );
};

export default Home;

