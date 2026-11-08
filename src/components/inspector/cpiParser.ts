// src/components/inspector/cpiParser.ts
import type { DecodedTransaction, DecodedInstruction } from "../../solana/transactionDecoder";
import type { SimulationResult } from "../../solana/simulateTransaction";
import type { RuleResult } from "../../solana/transactionRiskScore";
import type { CpiCallNode } from "./types";

const KNOWN_PROGRAMS: Record<string, string> = {
  "11111111111111111111111111111111": "SystemProgram",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": "TokenProgram",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb": "Token2022Program",
  "TokenzQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": "Token2022Program (Legacy)",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL": "AssociatedTokenProgram",
  "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr": "MemoProgram",
  "ComputeBudget111111111111111111111111111111": "ComputeBudgetProgram",
};

/**
 * Parses top-level instructions, simulation innerInstructions, and execution logs
 * into a structured hierarchical CPI execution tree.
 */
export function parseCpiCallTree(
  decoded?: DecodedTransaction | null,
  simulation?: SimulationResult | null,
  findings: RuleResult[] = [],
): CpiCallNode[] {
  if (!decoded || !decoded.instructions || decoded.instructions.length === 0) {
    return [];
  }

  const nodes: CpiCallNode[] = [];
  const innerIxMap = new Map<number, any[]>();

  // Map RPC innerInstructions by top-level instruction index
  if (simulation?.innerInstructions && Array.isArray(simulation.innerInstructions)) {
    for (const innerGroup of simulation.innerInstructions) {
      const idx = innerGroup.index;
      if (typeof idx === "number" && Array.isArray(innerGroup.instructions)) {
        innerIxMap.set(idx, innerGroup.instructions);
      }
    }
  }

  // Also parse invocation traces from logs if available
  const logInvocations = parseLogInvocations(simulation?.logs || []);

  decoded.instructions.forEach((ix, idx) => {
    const calleeProgramName = ix.programName || KNOWN_PROGRAMS[ix.programId] || "Unverified Custom Program";
    const instructionName = (ix.data as any)?.type || (typeof ix.data === "string" ? ix.data : "Execute");

    // Match findings associated with this instruction index, program ID, or affected accounts
    const ixAccountPubkeys = new Set([ix.programId, ...ix.accounts.map((a) => a.pubkey)]);
    const matchingRules = findings
      .filter(
        (f) =>
          f.instructionIndex === idx ||
          (f.affectedAccounts && f.affectedAccounts.some((acc) => ixAccountPubkeys.has(acc))),
      )
      .map((f) => f.id);

    // Build children CPI calls from innerInstructions
    const children: CpiCallNode[] = [];
    const rpcInners = innerIxMap.get(idx);

    if (rpcInners && rpcInners.length > 0) {
      rpcInners.forEach((inner, innerIdx) => {
        const calleePid = inner.programId || (inner.programIdIndex !== undefined && decoded.message.accountKeys[inner.programIdIndex]) || "Unknown";
        const childName = KNOWN_PROGRAMS[calleePid] || "Unverified Custom Program";

        const childAccounts = (inner.accounts || []).map((accIdxOrPubkey: any) => {
          if (typeof accIdxOrPubkey === "string") {
            return { pubkey: accIdxOrPubkey, isSigner: false, isWritable: true };
          }
          const pubkey = decoded.message.accountKeys[accIdxOrPubkey] || `acc_${accIdxOrPubkey}`;
          return { pubkey, isSigner: false, isWritable: true };
        });

        // Check for privilege escalation: did the child CPI attempt to use signers not authorized?
        const isSignerEscalation = childAccounts.some((ca: any) => ca.isSigner);
        const isWritableEscalation = childAccounts.some((ca: any) => ca.isWritable && !ix.accounts.some((a) => a.pubkey === ca.pubkey && a.isWritable));

        children.push({
          id: `cpi-${idx}-${innerIdx}`,
          depth: inner.stackHeight !== undefined ? inner.stackHeight : 1,
          callerProgramId: ix.programId,
          callerProgramName: calleeProgramName,
          calleeProgramId: calleePid,
          calleeProgramName: childName,
          instructionName: "CPI Invocation",
          isSignerEscalation,
          isWritableEscalation,
          accounts: childAccounts,
          triggeredRules: findings.filter((f) => f.affectedAccounts?.includes(calleePid)).map((f) => f.id),
          children: [],
          status: "success",
          rawData: inner.data,
        });
      });
    } else if (logInvocations.has(idx)) {
      // Reconstruct children from logs if innerInstructions RPC structure was omitted
      const logInners = logInvocations.get(idx)!;
      logInners.forEach((linner, lIdx) => {
        children.push({
          id: `cpi-log-${idx}-${lIdx}`,
          depth: linner.depth,
          callerProgramId: ix.programId,
          callerProgramName: calleeProgramName,
          calleeProgramId: linner.programId,
          calleeProgramName: KNOWN_PROGRAMS[linner.programId] || "Unverified Custom Program",
          instructionName: "CPI Invocation (from Logs)",
          isSignerEscalation: false,
          isWritableEscalation: false,
          accounts: [],
          triggeredRules: findings.filter((f) => f.affectedAccounts?.includes(linner.programId)).map((f) => f.id),
          children: [],
          status: linner.status,
        });
      });
    }

    const node: CpiCallNode = {
      id: `top-${idx}`,
      depth: 0,
      callerProgramId: "Wallet (Top-Level Transaction)",
      callerProgramName: "User Wallet",
      calleeProgramId: ix.programId,
      calleeProgramName,
      instructionName,
      discriminator: ix.rawBase64Data ? `Base64: ${ix.rawBase64Data.slice(0, 10)}…` : undefined,
      isSignerEscalation: false,
      isWritableEscalation: false,
      accounts: ix.accounts,
      triggeredRules: matchingRules,
      children,
      status: simulation?.error ? "failed" : "success",
      rawData: ix.rawBase64Data,
    };

    nodes.push(node);
  });

  return nodes;
}

interface LogInvocation {
  programId: string;
  depth: number;
  status: "success" | "failed";
}

/**
 * Parses execution logs like:
 * "Program 11111111111111111111111111111111 invoke [1]"
 * "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]"
 */
function parseLogInvocations(logs: string[]): Map<number, LogInvocation[]> {
  const result = new Map<number, LogInvocation[]>();
  let currentTopIndex = -1;

  for (const log of logs) {
    const invokeMatch = log.match(/Program\s+([A-Za-z0-9]{32,44})\s+invoke\s+\[(\d+)\]/);
    if (invokeMatch) {
      const pid = invokeMatch[1];
      const depth = parseInt(invokeMatch[2], 10);

      if (depth === 1) {
        currentTopIndex++;
      } else if (depth > 1 && currentTopIndex >= 0) {
        if (!result.has(currentTopIndex)) {
          result.set(currentTopIndex, []);
        }
        result.get(currentTopIndex)!.push({
          programId: pid,
          depth,
          status: "success",
        });
      }
    }
  }

  return result;
}
