// src/solana/simulateTransaction.ts
import { Buffer } from "buffer";
import type {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
  SimulatedTransactionResponse,
  RpcResponseAndContext,
  Commitment,
} from "@solana/web3.js";
import {
  Transaction as Tx,
  VersionedTransaction as VTx,
} from "@solana/web3.js";

/**
 * Result status of a simulation attempt.
 */
export type SimulationStatus =
  | "success"
  | "success_with_warnings"
  | "failed"
  | "unavailable";

/**
 * Account snapshot returned by simulation.
 */
export interface SimulatedAccountSnapshot {
  executable: boolean;
  owner: string;
  lamports: number;
  data: string[]; // [base64_data, encoding]
  rentEpoch?: number;
}

/**
 * Result of a simulation request.
 */
export interface SimulationResult {
  status: SimulationStatus;
  logs?: string[];
  error?: any;
  errorMessage?: string;
  computeUnitsConsumed?: number;
  returnedAccounts?: Record<string, string>; // base58 pubkey -> base64 data
  accountSnapshots?: Record<string, SimulatedAccountSnapshot>;
  innerInstructions?: any[];
  slot?: number;
  returnData?: {
    programId: string;
    data: [string, string];
  };
  // Indicates whether we have a full account-state diff (rarely provided by standard RPCs)
  hasFullAccountDiff: boolean;
  warnings?: string[];
  limitations: string[];
}

export interface SimulateTransactionOptions {
  accounts?: PublicKey[]; // account snapshots to request
  commitment?: Commitment;
  sigVerify?: boolean; // explicit override; defaults to true for signed tx, false for unsigned tx
  replaceRecentBlockhash?: boolean;
}

/**
 * Check whether a legacy or versioned transaction has valid signatures.
 */
function isTransactionSigned(tx: Transaction | VersionedTransaction): boolean {
  if ("signatures" in tx) {
    if (Array.isArray(tx.signatures)) {
      if (tx.signatures.length === 0) return false;
      // In legacy Transaction: signatures is Array<{ signature: Buffer | null, publicKey: PublicKey }>
      const first = tx.signatures[0];
      if (first && typeof first === "object" && "signature" in first) {
        return (tx.signatures as any[]).some((s) => s.signature !== null);
      }
      // In VersionedTransaction: signatures is Uint8Array[]
      return (tx.signatures as Uint8Array[]).some((sig) => sig.some((b) => b !== 0));
    }
  }
  return false;
}

/**
 * Simulate an unsigned or signed Solana transaction using the RPC `simulateTransaction` method.
 *
 * - Accepts a base64-encoded transaction (legacy or v0).
 * - For unsigned pre-sign inspection: disables signature verification (sigVerify: false) so
 *   simulation does not fail merely because signatures are absent.
 * - For signed transactions: enables signature verification (sigVerify: true).
 * - Never mutates the original transaction payload.
 * - Reports simulation limitations honestly:
 *     * Simulation success is not a guarantee of future on-chain execution.
 *     * Simulation failure alone is not proof of malicious intent.
 */
export async function simulateTransaction(
  base64Tx: string,
  connection: Connection,
  options?: SimulateTransactionOptions,
): Promise<SimulationResult> {
  const limitations: string[] = [
    "Simulation represents hypothetical execution at the RPC node's current slot and state.",
    "Simulation success does not guarantee future execution (chain state, blockhash expiry, or concurrent state changes may cause rejection).",
    "Simulation failure is not proof of malicious intent (missing prerequisite state or mock signatures may cause simulation to revert).",
    "On-chain account state diffs are limited to explicitly requested accounts; unrequested accounts do not include pre/post diffs.",
  ];

  if (typeof base64Tx !== "string" || !base64Tx.trim()) {
    return {
      status: "unavailable",
      hasFullAccountDiff: false,
      errorMessage: "Empty or invalid base64 transaction string provided for simulation.",
      limitations,
    };
  }

  const raw = Buffer.from(base64Tx.trim(), "base64");
  let parsedTx: Transaction | VersionedTransaction;
  let isLegacy = false;

  // 1. Parse transaction without mutating caller state
  try {
    parsedTx = Tx.from(raw);
    isLegacy = true;
  } catch (_) {
    try {
      parsedTx = VTx.deserialize(raw);
      isLegacy = false;
    } catch (deserErr: any) {
      return {
        status: "unavailable",
        hasFullAccountDiff: false,
        errorMessage: `Failed to deserialize transaction for simulation: ${deserErr?.message ?? "malformed wire format"}`,
        limitations,
      };
    }
  }

  const isSigned = isTransactionSigned(parsedTx);
  const warnings: string[] = [];

  // 2. Prepare VersionedTransaction payload for simulation
  // Wrapping legacy messages into VersionedTransaction avoids @solana/web3.js mutating legacy transactions
  let txToSimulate: VersionedTransaction;
  if (isLegacy) {
    const legacyTx = parsedTx as Transaction;
    txToSimulate = new VTx(legacyTx.compileMessage());
    if (isSigned) {
      // Copy existing signatures if signed
      const sigs = legacyTx.signatures
        .filter((s) => s.signature !== null)
        .map((s) => s.signature!);
      if (sigs.length > 0) {
        txToSimulate.signatures = sigs;
      }
    }
  } else {
    // Clone versioned transaction to guarantee zero mutation of input
    txToSimulate = VTx.deserialize(raw);
  }

  // Handle recentBlockhash if missing
  const currentBlockhash = (txToSimulate.message as any).recentBlockhash;
  if (!currentBlockhash || currentBlockhash === "11111111111111111111111111111111") {
    if (options?.replaceRecentBlockhash !== false) {
      try {
        const { blockhash } = await connection.getLatestBlockhash("processed");
        (txToSimulate.message as any).recentBlockhash = blockhash;
        warnings.push(
          "Transaction used a dummy or missing recentBlockhash; a fresh blockhash was substituted for simulation. The simulated payload may differ slightly from the signed payload.",
        );
      } catch (bhErr: any) {
        warnings.push(`Failed to fetch fresh blockhash for simulation: ${bhErr?.message ?? "RPC error"}`);
      }
    }
  }

  // 3. Configure simulation options
  // For unsigned transactions, sigVerify must be false so the RPC does not fail immediately on zeroed signatures
  const sigVerify = options?.sigVerify !== undefined ? options.sigVerify : isSigned;

  const simConfig: any = {
    sigVerify,
    commitment: options?.commitment ?? "processed",
    encoding: "base64",
    innerInstructions: true,
  };

  if (options?.accounts && options.accounts.length > 0) {
    simConfig.accounts = {
      encoding: "base64",
      addresses: options.accounts.map((a) => a.toBase58()),
    };
  }

  // 4. Execute simulation against the connection
  try {
    const resp: RpcResponseAndContext<SimulatedTransactionResponse> = await connection.simulateTransaction(
      txToSimulate,
      simConfig,
    );

    const value = resp?.value;
    const context = resp?.context;

    if (!value) {
      return {
        status: "unavailable",
        hasFullAccountDiff: false,
        warnings: [...warnings, "RPC returned an empty or malformed simulation response value."],
        limitations,
      };
    }

    const { err, logs, unitsConsumed, returnData, innerInstructions, accounts } = value;

    const returnedAccounts: Record<string, string> = {};
    const accountSnapshots: Record<string, SimulatedAccountSnapshot> = {};

    if (accounts && Array.isArray(accounts)) {
      accounts.forEach((acct: any, idx: number) => {
        if (!acct) return;
        const address = options?.accounts?.[idx]?.toBase58() ?? `account_${idx}`;
        accountSnapshots[address] = acct;
        if (acct.data && Array.isArray(acct.data) && acct.data[0]) {
          returnedAccounts[address] = acct.data[0];
        }
      });
    }

    const hasAccounts = Object.keys(returnedAccounts).length > 0;
    const isError = err !== null && err !== undefined;

    let status: SimulationStatus;
    if (isError) {
      status = "failed";
    } else if (warnings.length > 0) {
      status = "success_with_warnings";
    } else {
      status = "success";
    }

    return {
      status,
      logs: logs ?? undefined,
      error: err ?? undefined,
      errorMessage: isError
        ? typeof err === "string"
          ? err
          : JSON.stringify(err)
        : undefined,
      computeUnitsConsumed: unitsConsumed ?? undefined,
      slot: context?.slot ?? undefined,
      returnData: returnData ?? undefined,
      innerInstructions: innerInstructions ?? undefined,
      returnedAccounts: hasAccounts ? returnedAccounts : undefined,
      accountSnapshots: hasAccounts ? accountSnapshots : undefined,
      hasFullAccountDiff: hasAccounts,
      ...(warnings.length > 0 ? { warnings } : {}),
      limitations,
    };
  } catch (rpcErr: any) {
    const message = rpcErr?.message ?? "Simulation failed";
    const logs = rpcErr?.logs ?? undefined;

    return {
      status: "unavailable",
      error: rpcErr,
      errorMessage: message,
      logs,
      hasFullAccountDiff: false,
      warnings: [...warnings, `Simulation could not be executed on RPC: ${message}`],
      limitations,
    };
  }
}

export default simulateTransaction;
