// src/solana/transactionRiskScore.ts
import type { DecodedTransaction, DecodedInstruction } from "./transactionDecoder";
import { PublicKey } from "@solana/web3.js";

/**
 * Risk dimension identifiers.
 */
export type RiskDimension =
  | "amount"
  | "program"
  | "instructionCount"
  | "signer"
  | "account"
  | "inner";

/**
 * Configuration for risk scoring – weights for each dimension (must sum to 1).
 */
export interface RiskConfig {
  weights: Record<RiskDimension, number>;
  /** Threshold in lamports above which a transfer is considered high‑risk. */
  amountThresholdLamports: number;
  /** Maximum allowed number of instructions before raising risk. */
  maxInstructionCount: number;
  /** Maximum lamports for a token mint before flagging. */
  tokenMintThresholdLamports: number;
}

/** Default configuration (weights sum to 1). */
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  weights: {
    amount: 0.3,
    program: 0.2,
    instructionCount: 0.2,
    signer: 0.1,
    account: 0.1,
    inner: 0.1,
  },
  amountThresholdLamports: 10_000_000_000, // 10 SOL (lamports = 1e9 per SOL)
  maxInstructionCount: 5,
  tokenMintThresholdLamports: 1_000_000_000, // 1 SOL worth of tokens
};

/**
 * Result of a single rule evaluation.
 */
export interface RuleResult {
  id: string; // VS‑01 … VS‑08
  description: string;
  severity: number; // 0‑10 (higher = more severe)
  confidence: number; // 0‑1 (probability of truth)
  evidence: string;
  affectedAccounts: string[]; // base58
  dimension: RiskDimension;
}

/** Known program IDs for safe classification. */
const KNOWN_PROGRAM_IDS = new Set([
  "11111111111111111111111111111111", // SystemProgram (placeholder – actual is "11111111111111111111111111111111")
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "TokenzQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // Token‑2022 placeholder ID
]);

/**
 * Rule implementations – each receives the decoded transaction and returns a RuleResult.
 * Severity and confidence are independent; final risk contribution = weight * severity * confidence.
 */
const RULES: ((tx: DecodedTransaction) => RuleResult)[] = [
  // VS‑01 – Large SOL transfer amount
  (tx) => {
    const transferInstr = tx.instructions.find(
      (i) => i.programName === "SystemProgram" && (i.data as any)?.type === "Transfer"
    );
    const amount = (transferInstr?.data as any)?.lamports ?? 0;
    const exceeds = amount >= DEFAULT_RISK_CONFIG.amountThresholdLamports;
    return {
      id: "VS-01",
      description: "Large SOL transfer amount",
      severity: exceeds ? 9 : 0,
      confidence: exceeds ? 0.9 : 0,
      evidence: exceeds ? `Transfer lamports=${amount}` : "",
      affectedAccounts: transferInstr ? [
        // first account is payer, second is destination (by Solana convention)
        tx.message.accountKeys[0],
        tx.message.accountKeys[1],
      ] : [],
      dimension: "amount",
    };
  },
  // VS‑02 – Use of unknown program IDs (not automatically malicious)
  (tx) => {
    const unknownInstr = tx.instructions.find((i) => !KNOWN_PROGRAM_IDS.has(i.programId));
    if (!unknownInstr) {
      return {
        id: "VS-02",
        description: "Unknown program usage",
        severity: 0,
        confidence: 0,
        evidence: "",
        affectedAccounts: [],
        dimension: "program",
      };
    }
    return {
      id: "VS-02",
      description: "Transaction includes unknown program ID",
      severity: 2, // low severity – flag but not malicious
      confidence: 0.6,
      evidence: `Program ${unknownInstr.programId}`,
      affectedAccounts: unknownInstr.accounts.map((a) => a.pubkey),
      dimension: "program",
    };
  },
  // VS‑03 – Excessive instruction count
  (tx) => {
    const excessive = tx.instructions.length > DEFAULT_RISK_CONFIG.maxInstructionCount;
    return {
      id: "VS-03",
      description: "Too many instructions",
      severity: excessive ? 5 : 0,
      confidence: excessive ? 0.7 : 0,
      evidence: excessive ? `Count=${tx.instructions.length}` : "",
      affectedAccounts: [],
      dimension: "instructionCount",
    };
  },
  // VS‑04 – Unsigned transaction (no signatures)
  (tx) => {
    const unsigned = tx.signatures.length === 0;
    return {
      id: "VS-04",
      description: "Unsigned transaction",
      severity: unsigned ? 3 : 0,
      confidence: unsigned ? 0.95 : 0,
      evidence: unsigned ? "No signatures present" : "",
      affectedAccounts: [],
      dimension: "signer",
    };
  },
  // VS‑05 – Token mint amount exceeds threshold (for SPL Token program)
  (tx) => {
    const tokenInstr = tx.instructions.find((i) => i.programName === "TokenProgram" && (i.data as any)?.type === "MintTo");
    const amount = (tokenInstr?.data as any)?.amount ?? 0;
    const exceeds = amount >= DEFAULT_RISK_CONFIG.tokenMintThresholdLamports;
    return {
      id: "VS-05",
      description: "Large token mint amount",
      severity: exceeds ? 8 : 0,
      confidence: exceeds ? 0.85 : 0,
      evidence: exceeds ? `Mint amount=${amount}` : "",
      affectedAccounts: tokenInstr ? tokenInstr.accounts.map((a) => a.pubkey) : [],
      dimension: "amount",
    };
  },
  // VS‑06 – Deprecated program ID (example placeholder)
  (tx) => {
    const deprecatedIds = new Set(["Deprecated11111111111111111111111111111111111111"]);
    const deprecatedInstr = tx.instructions.find((i) => deprecatedIds.has(i.programId));
    if (!deprecatedInstr) {
      return {
        id: "VS-06",
        description: "Deprecated program usage",
        severity: 0,
        confidence: 0,
        evidence: "",
        affectedAccounts: [],
        dimension: "program",
      };
    }
    return {
      id: "VS-06",
      description: "Transaction uses a deprecated program",
      severity: 9,
      confidence: 0.9,
      evidence: `Program ${deprecatedInstr.programId}`,
      affectedAccounts: deprecatedInstr.accounts.map((a) => a.pubkey),
      dimension: "program",
    };
  },
  // VS‑07 – Instruction data empty (potentially malformed)
  (tx) => {
    const emptyDataInstr = tx.instructions.find((i) => i.data && (i.data as any).length === 0);
    if (!emptyDataInstr) {
      return {
        id: "VS-07",
        description: "Empty instruction data",
        severity: 0,
        confidence: 0,
        evidence: "",
        affectedAccounts: [],
        dimension: "instructionCount",
      };
    }
    return {
      id: "VS-07",
      description: "Instruction contains empty data payload",
      severity: 4,
      confidence: 0.7,
      evidence: `Program ${emptyDataInstr.programId}`,
      affectedAccounts: emptyDataInstr.accounts.map((a) => a.pubkey),
      dimension: "instructionCount",
    };
  },
  // VS‑08 – Presence of inner instructions (adds complexity)
  (tx) => {
    // In our decoded format we do not capture inner instructions directly.
    // We rely on an optional flag passed via external analysis – for demo we set false.
    const hasInner = false; // placeholder – can be extended from RPC simulation later.
    return {
      id: "VS-08",
      description: "Transaction contains inner instructions",
      severity: hasInner ? 6 : 0,
      confidence: hasInner ? 0.8 : 0,
      evidence: hasInner ? "inner instructions present" : "",
      affectedAccounts: [],
      dimension: "inner",
    };
  },
];

/**
 * Compute the deterministic Solana Transaction Risk Score (STRS).
 * Returns a numeric score (0‑100) and a detailed breakdown per rule.
 */
export function computeRiskScore(
  decodedTx: DecodedTransaction,
  config: RiskConfig = DEFAULT_RISK_CONFIG,
): { score: number; breakdown: RuleResult[] } {
  const breakdown: RuleResult[] = RULES.map((fn) => fn(decodedTx));
  // Weighted sum of severity * confidence for each dimension using config.weights
  let weightedSum = 0;
  for (const dim of Object.keys(config.weights) as RiskDimension[]) {
    const dimWeight = config.weights[dim];
    const dimContribution = breakdown
      .filter((r) => r.dimension === dim)
      .reduce((acc, r) => acc + r.severity * r.confidence, 0);
    weightedSum += dimWeight * dimContribution;
  }
  // Normalize to 0‑100 (max possible severity 10, confidence 1, weight sums to 1)
  const maxPossible = 10; // severity max * confidence max = 10
  const score = Math.min(100, Math.round((weightedSum / maxPossible) * 100));
  return { score, breakdown };
}

export default computeRiskScore;

