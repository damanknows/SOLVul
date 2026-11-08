// src/solana/simulateTransaction.ts
import { Buffer } from "buffer";
import type { Connection, PublicKey, Transaction, VersionedTransaction, SimulatedTransactionResponse } from "@solana/web3.js";
import { Transaction as Tx, VersionedTransaction as VTx } from "@solana/web3.js";
import { decodeTransaction } from "./transactionDecoder";

/**
 * Result of a simulation request.
 */
export interface SimulationResult {
  logs?: string[];
  error?: any;
  computeUnitsConsumed?: number;
  returnedAccounts?: Record<string, string>; // base58 pubkey -> base64 data
  innerInstructions?: any[];
  // Indicates whether we have a full account‑state diff (rarely provided by RPC)
  hasFullAccountDiff: boolean;
}

/**
 * Simulate an unsigned Solana transaction using the RPC `simulateTransaction` method.
 *
 * - Accepts a base64‑encoded transaction (legacy or v0).
 * - Optionally a list of account public keys whose snapshots should be returned.
 * - Verifies signatures if present (none for unsigned tx).
 * - Replaces recent blockhash if missing.
 *
 * Note: The RPC may not return a complete account‑state diff; we only expose
 *   the data that is actually available.
 */
export async function simulateTransaction(
  base64Tx: string,
  connection: Connection,
  options?: {
    accounts?: PublicKey[]; // account snapshots to request
    commitment?: string;
  },
): Promise<SimulationResult> {
  const raw = Buffer.from(base64Tx, "base64");
  let tx: Transaction | VersionedTransaction;
  let isVersioned = false;
  // Try legacy first
  try {
    tx = Tx.from(raw) as Transaction;
  } catch (_) {
    // If legacy parsing fails, try v0
    if (typeof VTx === "undefined") {
      throw new Error("VersionedTransaction not supported by the installed @solana/web3.js SDK.");
    }
    tx = VTx.from(raw) as VersionedTransaction;
    isVersioned = true;
  }

  // Ensure recentBlockhash is set – for unsigned tx we can fetch from RPC
  if (!("recentBlockhash" in tx) || !(tx as any).recentBlockhash) {
    const { blockhash } = await connection.getLatestBlockhash();
    (tx as any).recentBlockhash = blockhash;
  }

  // Build simulation config
  const simOptions: any = {
    sigVerify: true,
    replaceRecentBlockhash: true,
    commitment: options?.commitment ?? "processed",
  };

  if (options?.accounts && options.accounts.length > 0) {
    simOptions.accounts = {
      encoding: "base64",
      addresses: options.accounts.map((a: PublicKey) => a.toBase58()),
    };
  }

  const resp: SimulatedTransactionResponse = await connection.simulateTransaction(tx, simOptions);

  const result: SimulationResult = {
    hasFullAccountDiff: !!(resp.accounts && Object.keys(resp.accounts).length > 0),
  };

  if (resp.value) {
    const { err, logs, unitsConsumed, returnData, innerInstructions, accounts } = resp.value;
    result.error = err ?? undefined;
    result.logs = logs ?? undefined;
    result.computeUnitsConsumed = unitsConsumed ?? undefined;
    result.innerInstructions = innerInstructions ?? undefined;
    if (accounts) {
      result.returnedAccounts = {};
      for (const [addr, acct] of Object.entries(accounts)) {
        result.returnedAccounts[addr] = (acct as any).data[0]; // data[0] is base64 content
      }
    }
  }

  return result;
}

export default simulateTransaction;

