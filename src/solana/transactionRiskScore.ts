// src/solana/transactionRiskScore.ts
import type { DecodedTransaction } from "./transactionDecoder";
import type { SimulationResult } from "./simulateTransaction";
import { PROGRAM_IDS } from "./transactionDecoder";

/**
 * Risk dimension identifiers.
 */
export type RiskDimension =
  | "amount"
  | "program"
  | "instructionCount"
  | "authority"
  | "simulation"
  | "complexity";

/**
 * Overall risk level categories.
 */
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/**
 * Configuration for risk scoring – weights for each dimension (must sum to 1).
 */
export interface RiskConfig {
  /** Dimension weights (sum to 1.0). Labeled provisional until formal benchmark validation. */
  weights: Record<RiskDimension, number>;
  /** Threshold in lamports above which a single SOL transfer raises elevated risk (default 10 SOL). */
  amountThresholdLamports: number;
  /** Maximum normal instruction count before complexity risk applies (default 5). */
  maxInstructionCount: number;
  /** Maximum safe token base unit threshold when decimals are unknown (default 1,000,000,000). */
  tokenRawAmountThreshold: bigint;
}

/** Default provisional configuration (weights sum to 1.0). */
export const DEFAULT_RISK_CONFIG: RiskConfig = {
  weights: {
    amount: 0.25,
    program: 0.20,
    authority: 0.25,
    simulation: 0.15,
    complexity: 0.10,
    instructionCount: 0.05,
  },
  amountThresholdLamports: 10_000_000_000, // 10 SOL (1e9 lamports = 1 SOL)
  maxInstructionCount: 5,
  tokenRawAmountThreshold: 1_000_000_000n,
};

/**
 * Result of a single evidence-based rule evaluation.
 */
export interface RuleResult {
  /** Stable identifier: VS-01 to VS-08 */
  id: string;
  /** Short human-readable title */
  description: string;
  /** Risk severity (0 to 10) representing potential adverse impact */
  severity: number;
  /** Detection confidence (0 to 1) representing evidence certainty */
  confidence: number;
  /** Detailed human-readable explanation of why this was flagged */
  explanation: string;
  /** Key evidence fields extracted from the instruction/transaction */
  evidence: Record<string, any>;
  /** Specific instruction index where the pattern was detected (if applicable) */
  instructionIndex?: number;
  /** Affected Solana account public keys (base58) */
  affectedAccounts: string[];
  /** Risk dimension grouping */
  dimension: RiskDimension;
  /** Missing data, unverifiable state, or known limitations */
  limitations?: string;
  /** Suggested safe action for the user */
  suggestedAction?: string;
}

export type FindingBreakdown = RuleResult;

/**
 * Output of the deterministic Solana Transaction Risk Score (STRS).
 */
export interface TransactionRiskAssessment {
  score: number; // 0 to 100 mathematically bounded
  riskLevel: RiskLevel;
  confidence: number; // Aggregate confidence 0.0 to 1.0
  dimensions: Record<RiskDimension, { score: number; weight: number }>;
  breakdown: RuleResult[]; // Non-zero findings for UI and explanation engine
  allRulesEvaluated: RuleResult[]; // Complete evaluation list
  limitations: string[];
  scoringVersion: string;
}

/** Known official program IDs considered verified. */
const KNOWN_PROGRAM_IDS = new Set<string>([
  PROGRAM_IDS.SystemProgram, // "11111111111111111111111111111111"
  PROGRAM_IDS.TokenProgram, // "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
  PROGRAM_IDS.Token2022Program, // "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL", // Associated Token Program
  "ComputeBudget111111111111111111111111111111", // Compute Budget Program
]);

/**
 * Helper to derive category label from numeric STRS score.
 */
function deriveRiskLevel(score: number): RiskLevel {
  if (score >= 70) return "CRITICAL";
  if (score >= 45) return "HIGH";
  if (score >= 20) return "MEDIUM";
  return "LOW";
}

/**
 * Rule 1: VS-01 — High SOL transfer amount or multiple SOL transfers
 */
function evaluateSolTransfers(tx: DecodedTransaction, config: RiskConfig): RuleResult[] {
  const transferIxs = tx.instructions
    .map((ix, idx) => ({ ix, idx }))
    .filter(
      ({ ix }) =>
        ix.programName === "SystemProgram" &&
        ix.data &&
        typeof ix.data === "object" &&
        (ix.data as any).type === "Transfer",
    );

  if (transferIxs.length === 0) return [];

  const results: RuleResult[] = [];
  let totalLamports = 0;

  for (const { ix, idx } of transferIxs) {
    const lamports = (ix.data as any).lamports ?? 0;
    totalLamports += lamports;
    const fromPubkey = ix.accounts[0]?.pubkey ?? "Unknown";
    const toPubkey = ix.accounts[1]?.pubkey ?? "Unknown";

    if (lamports >= config.amountThresholdLamports) {
      results.push({
        id: "VS-01",
        description: "Large SOL transfer amount",
        severity: 8,
        confidence: 0.95,
        explanation: `Transfer of ${(lamports / 1e9).toFixed(3)} SOL exceeds threshold of ${(config.amountThresholdLamports / 1e9).toFixed(3)} SOL.`,
        evidence: {
          instructionIndex: idx,
          lamports,
          solEquivalent: lamports / 1e9,
          from: fromPubkey,
          to: toPubkey,
        },
        instructionIndex: idx,
        affectedAccounts: [fromPubkey, toPubkey].filter((a) => a !== "Unknown"),
        dimension: "amount",
        limitations: "Threshold is configured statically; does not reflect user account total balance.",
        suggestedAction: "Verify that the recipient address and the SOL amount match your intended transaction.",
      });
    }
  }

  // Check for multi-transfer drain pattern (more than 2 transfers in single tx)
  if (transferIxs.length > 2) {
    const allAffected = Array.from(
      new Set(transferIxs.flatMap(({ ix }) => ix.accounts.map((a) => a.pubkey))),
    );
    results.push({
      id: "VS-01-MULTI",
      description: "Multiple SOL transfers in single transaction",
      severity: 5,
      confidence: 0.9,
      explanation: `Transaction contains ${transferIxs.length} separate SOL transfers totaling ${(totalLamports / 1e9).toFixed(3)} SOL.`,
      evidence: {
        transferCount: transferIxs.length,
        totalLamports,
        totalSol: totalLamports / 1e9,
      },
      affectedAccounts: allAffected,
      dimension: "amount",
      suggestedAction: "Confirm whether batch transfers to these destinations are expected.",
    });
  }

  return results;
}

/**
 * Rule 2: VS-02 — Unverified Program Interaction
 * Important: An unknown program is unverified, NEVER automatically marked malicious.
 */
function evaluateUnverifiedPrograms(tx: DecodedTransaction): RuleResult[] {
  const unverifiedIxs = tx.instructions
    .map((ix, idx) => ({ ix, idx }))
    .filter(({ ix }) => !KNOWN_PROGRAM_IDS.has(ix.programId));

  if (unverifiedIxs.length === 0) return [];

  const uniqueProgramIds = Array.from(new Set(unverifiedIxs.map(({ ix }) => ix.programId)));

  return [
    {
      id: "VS-02",
      description: "Unverified Program Interaction",
      severity: 3, // Low severity: unverified is informational/cautionary, not malicious
      confidence: 0.7,
      explanation: `Transaction interacts with ${uniqueProgramIds.length} program(s) not in the standard verified list: ${uniqueProgramIds.join(", ")}.`,
      evidence: {
        unverifiedProgramIds: uniqueProgramIds,
        instructionIndexes: unverifiedIxs.map(({ idx }) => idx),
      },
      affectedAccounts: uniqueProgramIds,
      dimension: "program",
      limitations: "An unverified program is not automatically malicious; custom contracts, games, and new protocols will appear unverified.",
      suggestedAction: "Confirm that you trust the dapp deploying or invoking these unverified program IDs.",
    },
  ];
}

/**
 * Rule 3: VS-03 — Excessive instruction count
 */
function evaluateInstructionCount(tx: DecodedTransaction, config: RiskConfig): RuleResult[] {
  const count = tx.instructions.length;
  if (count <= config.maxInstructionCount) return [];

  return [
    {
      id: "VS-03",
      description: "Excessive instruction count",
      severity: Math.min(6, 2 + Math.floor((count - config.maxInstructionCount) / 2)),
      confidence: 0.9,
      explanation: `Transaction contains ${count} instructions, exceeding standard limit of ${config.maxInstructionCount}. Complex transactions may hide adverse instructions.`,
      evidence: { instructionCount: count, threshold: config.maxInstructionCount },
      affectedAccounts: [],
      dimension: "instructionCount",
      suggestedAction: "Inspect each individual instruction in the list carefully before approving.",
    },
  ];
}

/**
 * Rule 4: VS-04 — Unsupported or Unresolved Data (replaced the invalid unsigned transaction rule)
 */
function evaluateUnsupportedData(tx: DecodedTransaction): RuleResult[] {
  const results: RuleResult[] = [];

  const unsupportedIxs = tx.instructions
    .map((ix, idx) => ({ ix, idx }))
    .filter(({ ix }) => ix.isUnsupported);

  if (unsupportedIxs.length > 0) {
    results.push({
      id: "VS-04",
      description: "Unsupported or unverified instruction format",
      severity: 4,
      confidence: 0.85,
      explanation: `${unsupportedIxs.length} instruction(s) could not be fully decoded with standard schemas.`,
      evidence: {
        unsupportedCount: unsupportedIxs.length,
        reasons: unsupportedIxs.map(({ ix }) => ix.unsupportedReason).filter(Boolean),
      },
      affectedAccounts: Array.from(
        new Set(unsupportedIxs.flatMap(({ ix }) => ix.accounts.map((a) => a.pubkey))),
      ),
      dimension: "complexity",
      limitations: "Novel programs or custom instruction layouts cannot be parsed without IDL.",
      suggestedAction: "Only proceed if you trust the application constructing this custom instruction payload.",
    });
  }

  if (tx.unresolvedLookupTables && tx.unresolvedLookupTables.length > 0) {
    results.push({
      id: "VS-04-LUT",
      description: "Unresolved Address Lookup Tables",
      severity: 5,
      confidence: 0.95,
      explanation: `${tx.unresolvedLookupTables.length} Address Lookup Table(s) could not be resolved from RPC. Account keys may be incomplete.`,
      evidence: { unresolvedTables: tx.unresolvedLookupTables },
      affectedAccounts: tx.unresolvedLookupTables.map((t) => t.lookupTableKey),
      dimension: "complexity",
      limitations: "Missing lookup tables prevent complete verification of instruction account destinations.",
      suggestedAction: "Ensure RPC connectivity and re-inspect before signing.",
    });
  }

  return results;
}

/**
 * Rule 5: VS-05 — Token transfers, approvals, delegations, mints, and burns
 */
function evaluateTokenInstructions(tx: DecodedTransaction, config: RiskConfig): RuleResult[] {
  const results: RuleResult[] = [];

  tx.instructions.forEach((ix, idx) => {
    if (ix.programName !== "TokenProgram" && ix.programName !== "Token2022Program") return;
    if (!ix.data || typeof ix.data !== "object") return;
    const data = ix.data as any;
    const type = data.type as string;

    // A. Approvals and delegations (High risk of account drain)
    if (type === "Approve" || type === "ApproveChecked") {
      const delegate = data.parsedKeys?.delegate ?? ix.accounts[1]?.pubkey ?? "Unknown";
      const owner = data.parsedKeys?.owner ?? ix.accounts[2]?.pubkey ?? "Unknown";
      const rawAmt = data.rawTokenAmount ?? String(data.amount ?? "unknown");
      results.push({
        id: "VS-05-APPROVE",
        description: "Token Delegate Approval",
        severity: 7, // High impact: granting delegate authority to transfer tokens
        confidence: 0.95,
        explanation: `Instruction grants third-party delegate (${delegate}) permission to transfer ${data.formattedTokenAmount ?? rawAmt} tokens from owner ${owner}.`,
        evidence: {
          instructionIndex: idx,
          delegate,
          owner,
          amount: data.amount,
          rawTokenAmount: data.rawTokenAmount,
          formattedTokenAmount: data.formattedTokenAmount,
          isFormattedWithDecimals: data.isFormattedWithDecimals,
        },
        instructionIndex: idx,
        affectedAccounts: [delegate, owner].filter((a) => a !== "Unknown"),
        dimension: "authority",
        suggestedAction: "Confirm that you intend to grant this delegate permission to transfer your tokens.",
      });
    }

    // B. Large Token Minting
    if (type === "MintTo" || type === "MintToChecked") {
      const rawAmtBig = data.rawTokenAmount ? BigInt(data.rawTokenAmount) : BigInt(data.amount ?? 0);
      const exceeds = rawAmtBig >= config.tokenRawAmountThreshold;
      if (exceeds) {
        results.push({
          id: "VS-05",
          description: "Large token mint amount",
          severity: 6,
          confidence: 0.85,
          explanation: `Token MintTo instruction specifies ${data.formattedTokenAmount ?? rawAmtBig.toString()} base units.`,
          evidence: {
            instructionIndex: idx,
            amount: data.amount,
            rawTokenAmount: data.rawTokenAmount,
            formattedTokenAmount: data.formattedTokenAmount,
          },
          instructionIndex: idx,
          affectedAccounts: ix.accounts.map((a) => a.pubkey),
          dimension: "amount",
          limitations: "Token base units evaluated; economic value requires oracle price feed.",
          suggestedAction: "Verify that this minting operation is authorized.",
        });
      }
    }
  });

  return results;
}

/**
 * Rule 6: VS-06 — Authority Changes and Account Ownership Reassignment
 */
function evaluateAuthorityChanges(tx: DecodedTransaction): RuleResult[] {
  const results: RuleResult[] = [];

  tx.instructions.forEach((ix, idx) => {
    // 1. SPL Token / Token-2022 SetAuthority
    if (
      (ix.programName === "TokenProgram" || ix.programName === "Token2022Program") &&
      ix.data &&
      typeof ix.data === "object"
    ) {
      const data = ix.data as any;
      if (data.type === "SetAuthority") {
        const authType = data.authorityTypeName ?? `Type_${data.authorityType}`;
        const newAuth = data.newAuthority ?? data.parsedKeys?.newAuthority ?? "Unknown";
        results.push({
          id: "VS-06",
          description: "Token Authority Reassignment",
          severity: 9, // Critical: ownership/mint/freeze authority transfer
          confidence: 0.95,
          explanation: `Transfers ${authType} to ${newAuth}. The previous authority will permanently lose control.`,
          evidence: {
            instructionIndex: idx,
            authorityType: authType,
            newAuthority: newAuth,
          },
          instructionIndex: idx,
          affectedAccounts: ix.accounts.map((a) => a.pubkey),
          dimension: "authority",
          suggestedAction: "Caution: Permanently relinquishes token control. Reject unless you are deliberately changing authorities.",
        });
      }
    }

    // 2. SystemProgram::Assign (Silent account owner reassignment)
    if (ix.programName === "SystemProgram" && ix.data && typeof ix.data === "object") {
      const data = ix.data as any;
      if (data.type === "Assign" || data.type === "AssignWithSeed") {
        results.push({
          id: "VS-06-ASSIGN",
          description: "SystemProgram Account Owner Reassignment",
          severity: 9, // Critical severity
          confidence: 0.95,
          explanation: "Reassigns the owner of your Solana account to a new program. This is a severe, irreversible action.",
          evidence: {
            instructionIndex: idx,
            type: data.type,
          },
          instructionIndex: idx,
          affectedAccounts: ix.accounts.map((a) => a.pubkey),
          dimension: "authority",
          suggestedAction: "Reject this transaction unless you explicitly intend to transfer ownership of your account.",
        });
      }
    }
  });

  return results;
}

/**
 * Rule 7: VS-07 — Account Closures
 */
function evaluateAccountClosures(tx: DecodedTransaction): RuleResult[] {
  const results: RuleResult[] = [];

  tx.instructions.forEach((ix, idx) => {
    if (
      (ix.programName === "TokenProgram" || ix.programName === "Token2022Program") &&
      ix.data &&
      typeof ix.data === "object"
    ) {
      const data = ix.data as any;
      if (data.type === "CloseAccount") {
        const destination = data.parsedKeys?.destination ?? ix.accounts[1]?.pubkey ?? "Unknown";
        results.push({
          id: "VS-07",
          description: "Token Account Closure",
          severity: 6,
          confidence: 0.9,
          explanation: `Closes token account and drains remaining rent lamports to ${destination}.`,
          evidence: {
            instructionIndex: idx,
            closedAccount: ix.accounts[0]?.pubkey,
            rentDestination: destination,
          },
          instructionIndex: idx,
          affectedAccounts: ix.accounts.map((a) => a.pubkey),
          dimension: "authority",
          suggestedAction: "Confirm that this token account is empty and intended for permanent closure.",
        });
      }
    }
  });

  return results;
}

/**
 * Rule 8: VS-08 — Simulation Evidence (errors, execution reverts, compute units)
 */
function evaluateSimulationEvidence(simulation?: SimulationResult): RuleResult[] {
  if (!simulation) return [];

  const results: RuleResult[] = [];

  if (simulation.status === "failed") {
    results.push({
      id: "VS-08-ERR",
      description: "Simulation Reverted or Failed",
      severity: 6, // Elevates risk, but honestly acknowledges failure != malicious
      confidence: 0.85,
      explanation: `Transaction simulation failed on Devnet: ${simulation.errorMessage ?? "Transaction failed with error"}.`,
      evidence: {
        error: simulation.error,
        logs: simulation.logs?.slice(-5), // last 5 logs
      },
      affectedAccounts: [],
      dimension: "simulation",
      limitations: "Simulation failure alone is not proof of maliciousness; it may indicate stale state, slippage, or missing tokens.",
      suggestedAction: "Do not approve unless you understand why the simulation reverted.",
    });
  }

  return results;
}

/**
 * Master STRS Rules Evaluator.
 */
const STRS_RULES: ((tx: DecodedTransaction, config: RiskConfig, sim?: SimulationResult) => RuleResult[])[] = [
  (tx, config) => evaluateSolTransfers(tx, config),
  (tx) => evaluateUnverifiedPrograms(tx),
  (tx, config) => evaluateInstructionCount(tx, config),
  (tx) => evaluateUnsupportedData(tx),
  (tx, config) => evaluateTokenInstructions(tx, config),
  (tx) => evaluateAuthorityChanges(tx),
  (tx) => evaluateAccountClosures(tx),
  (tx, _, sim) => evaluateSimulationEvidence(sim),
];

/**
 * Compute the deterministic Solana Transaction Risk Score (STRS).
 *
 * Mathematically bounded:
 * - Output score is strictly guaranteed in [0, 100].
 * - Dimension contributions are weighted and bounded.
 * - Score is 100% reproducible for identical inputs.
 * - Low confidence does NOT inflate risk severity.
 */
export function computeRiskScore(
  decodedTx: DecodedTransaction,
  config: RiskConfig = DEFAULT_RISK_CONFIG,
  simulation?: SimulationResult,
): TransactionRiskAssessment {
  const allFindings: RuleResult[] = [];

  for (const ruleFn of STRS_RULES) {
    const findings = ruleFn(decodedTx, config, simulation);
    allFindings.push(...findings);
  }

  // Deduplicate findings by (id + instructionIndex)
  const seenKeys = new Set<string>();
  const deduplicatedFindings: RuleResult[] = [];
  for (const f of allFindings) {
    const key = `${f.id}_${f.instructionIndex ?? "all"}_${f.description}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      deduplicatedFindings.push(f);
    }
  }

  // Calculate dimension scores
  // For each dimension: score is min(10, max(severity * confidence))
  const dimensionScores: Record<RiskDimension, { score: number; weight: number }> = {
    amount: { score: 0, weight: config.weights.amount },
    program: { score: 0, weight: config.weights.program },
    instructionCount: { score: 0, weight: config.weights.instructionCount },
    authority: { score: 0, weight: config.weights.authority },
    simulation: { score: 0, weight: config.weights.simulation },
    complexity: { score: 0, weight: config.weights.complexity },
  };

  for (const f of deduplicatedFindings) {
    const currentDim = dimensionScores[f.dimension];
    if (currentDim) {
      const ruleContribution = f.severity * f.confidence;
      currentDim.score = Math.min(10, Math.max(currentDim.score, ruleContribution));
    }
  }

  // Aggregate weighted score: sum(dimScore * weight) normalized to 0-100
  let weightedSum = 0;
  let totalWeight = 0;

  for (const dim of Object.keys(dimensionScores) as RiskDimension[]) {
    const { score, weight } = dimensionScores[dim];
    weightedSum += score * weight;
    totalWeight += weight;
  }

  // If critical authority hijack or assign detected, guarantee high floor score
  const hasCriticalAuthorityHijack = deduplicatedFindings.some(
    (f) => f.dimension === "authority" && f.severity >= 9,
  );

  let rawScore = totalWeight > 0 ? (weightedSum / (10 * totalWeight)) * 100 : 0;
  if (hasCriticalAuthorityHijack) {
    rawScore = Math.max(rawScore, 75); // Floor at CRITICAL
  }

  // Strictly clamp between 0 and 100
  const finalScore = Math.min(100, Math.max(0, Math.round(rawScore)));

  // Calculate overall confidence (average of active finding confidences, or 1.0 if clean)
  const confidences = deduplicatedFindings.map((f) => f.confidence);
  const aggregateConfidence =
    confidences.length > 0
      ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(2))
      : 1.0;

  return {
    score: finalScore,
    riskLevel: deriveRiskLevel(finalScore),
    confidence: aggregateConfidence,
    dimensions: dimensionScores,
    breakdown: deduplicatedFindings.filter((f) => f.severity > 0),
    allRulesEvaluated: deduplicatedFindings,
    limitations: [
      "Weights and thresholds are provisional pending empirical benchmark validation.",
      "Offline static analysis cannot evaluate dynamic on-chain oracle prices or liquidity pools.",
      "Unverified programs are flagged for user caution, not proven malicious.",
    ],
    scoringVersion: "STRS-v2.0-deterministic",
  };
}

export default computeRiskScore;
