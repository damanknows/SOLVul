// src/solana/client.ts
import { Connection } from "@solana/web3.js";
import { env } from "../lib/env";

/**
 * Solana RPC connection to the Devnet endpoint defined in env.
 * This client is **read‑only** – no signing capabilities are attached.
 */
export const solanaConnection = new Connection(env.SOLANA_RPC_ENDPOINT, "confirmed");

