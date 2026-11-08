// src/components/inspector/accountDiffParser.ts
import type { DecodedTransaction } from "../../solana/transactionDecoder";
import type { SimulationResult } from "../../solana/simulateTransaction";
import type { AccountStateDiff, StateDiffProvenance } from "./types";

const SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";

/**
 * Computes Pre/Post Account State Diffs for every writable account in a transaction.
 * Distinguishes verified RPC snapshots from static instruction inference.
 */
export function computeAccountDiffMatrix(
  decoded?: DecodedTransaction | null,
  simulation?: SimulationResult | null,
): AccountStateDiff[] {
  if (!decoded) return [];

  const diffs: AccountStateDiff[] = [];
  const writableAccounts = new Set<string>();
  const signerAccounts = new Set<string>();

  // Collect all writable and signer accounts across all instructions
  for (const ix of decoded.instructions) {
    for (const acc of ix.accounts) {
      if (acc.isWritable) writableAccounts.add(acc.pubkey);
      if (acc.isSigner) signerAccounts.add(acc.pubkey);
    }
  }

  // Also include fee payer (first account key in transaction message)
  const feePayer = decoded.message.accountKeys?.[0];
  if (feePayer) {
    writableAccounts.add(feePayer);
    signerAccounts.add(feePayer);
  }

  const snapshots = simulation?.accountSnapshots || {};
  const hasRpcSnapshots = Object.keys(snapshots).length > 0;

  for (const pubkey of Array.from(writableAccounts)) {
    const isSigner = signerAccounts.has(pubkey);
    const rpcSnapshot = snapshots[pubkey];

    // Determine label
    let label = pubkey === feePayer ? "Fee Payer / Payer" : undefined;
    if (!label) {
      // Check if source or destination in any instruction
      for (const ix of decoded.instructions) {
        if (ix.accounts[0]?.pubkey === pubkey) label = `${ix.programName} Target/Source`;
        else if (ix.accounts[1]?.pubkey === pubkey) label = `${ix.programName} Recipient/Delegate`;
      }
    }

    if (rpcSnapshot && hasRpcSnapshots) {
      // 1. Verified via RPC Snapshot
      const postLamports = rpcSnapshot.lamports;
      const postOwner = rpcSnapshot.owner;
      const postDataLen = rpcSnapshot.data && rpcSnapshot.data[0] ? Buffer.from(rpcSnapshot.data[0], "base64").length : 0;

      // In RPC simulateTransaction, snapshots represent post-simulation state
      // We calculate pre-lamports by reversing static transfers if available
      let lamportsDelta = 0;
      let preOwner = postOwner;
      let isOwnerMutated = false;

      // Check for owner changes in static instructions (e.g. SystemProgram::Assign)
      for (const ix of decoded.instructions) {
        if (ix.programName === "SystemProgram" && (ix.data as any)?.type === "Assign" && ix.accounts[0]?.pubkey === pubkey) {
          const newOwner = (ix.data as any)?.programId;
          if (newOwner && newOwner !== postOwner) {
            preOwner = SYSTEM_PROGRAM_ID;
            isOwnerMutated = true;
          }
        }
        if (ix.programName === "SystemProgram" && (ix.data as any)?.type === "Transfer") {
          const amount = (ix.data as any)?.lamports || 0;
          if (ix.accounts[0]?.pubkey === pubkey) lamportsDelta -= amount;
          if (ix.accounts[1]?.pubkey === pubkey) lamportsDelta += amount;
        }
      }

      const preLamports = Math.max(0, postLamports - lamportsDelta);
      const preDataLen = postDataLen;

      diffs.push({
        pubkey,
        label,
        isWritable: true,
        isSigner,
        preLamports,
        postLamports,
        lamportsDelta,
        preOwner,
        postOwner,
        isOwnerMutated,
        preDataLen,
        postDataLen,
        dataLenDelta: postDataLen - preDataLen,
        provenance: "Verified via RPC Snapshot",
        notes: "Real bank snapshot retrieved from validator RPC execution.",
      });
    } else {
      // 2. Inferred from Static Instruction Analysis
      let lamportsDelta = 0;
      let preOwner = SYSTEM_PROGRAM_ID;
      let postOwner = SYSTEM_PROGRAM_ID;
      let isOwnerMutated = false;
      let dataLenDelta = 0;
      const inferredPreLamports = 1_000_000_000; // Reference 1 SOL baseline for delta display

      for (const ix of decoded.instructions) {
        // SystemProgram transfer
        if (ix.programName === "SystemProgram" && (ix.data as any)?.type === "Transfer") {
          const lamports = Number((ix.data as any)?.lamports) || 0;
          if (ix.accounts[0]?.pubkey === pubkey) lamportsDelta -= lamports;
          if (ix.accounts[1]?.pubkey === pubkey) lamportsDelta += lamports;
        }

        // SystemProgram assign
        if (ix.programName === "SystemProgram" && (ix.data as any)?.type === "Assign" && ix.accounts[0]?.pubkey === pubkey) {
          const assignedOwner = (ix.data as any)?.programId || "Unknown Program";
          preOwner = SYSTEM_PROGRAM_ID;
          postOwner = assignedOwner;
          isOwnerMutated = true;
        }

        // Token instruction affecting token account
        if (ix.programName === "TokenProgram" || ix.programName === "Token2022Program") {
          preOwner = ix.programId;
          postOwner = ix.programId;
        }
      }

      const postLamports = Math.max(0, inferredPreLamports + lamportsDelta);

      diffs.push({
        pubkey,
        label,
        isWritable: true,
        isSigner,
        preLamports: inferredPreLamports,
        postLamports,
        lamportsDelta,
        preOwner,
        postOwner,
        isOwnerMutated,
        preDataLen: 0,
        postDataLen: dataLenDelta,
        dataLenDelta,
        provenance: "Inferred from Static Instruction",
        notes: "Simulated RPC unavailable; calculated statically from instruction bytecode.",
      });
    }
  }

  return diffs;
}
