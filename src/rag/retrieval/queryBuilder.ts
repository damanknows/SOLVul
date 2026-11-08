// src/rag/retrieval/queryBuilder.ts
import type { RetrievalQuery } from "../types";
import type { DecodedTransaction } from "../../solana/transactionDecoder";
import type { FindingBreakdown } from "../../solana/transactionRiskScore";

/**
 * Constructs targeted security retrieval queries based on deterministic STRS findings
 * and decoded instruction data.
 *
 * Never includes private keys, seed phrases, or sensitive wallet secrets in queries.
 */
export function buildQueriesForFindings(
  findings: FindingBreakdown[],
  decoded?: DecodedTransaction,
): RetrievalQuery[] {
  const queries: RetrievalQuery[] = [];

  for (const finding of findings) {
    const query = buildQueryForFinding(finding, decoded);
    if (query) {
      queries.push(query);
    }
  }

  // If no findings or no specific queries were generated, build a context query from instructions
  if (queries.length === 0 && decoded && decoded.instructions.length > 0) {
    for (const ix of decoded.instructions) {
      const ixQuery = buildQueryForInstruction(ix);
      if (ixQuery) {
        queries.push(ixQuery);
      }
    }
  }

  return queries;
}

/**
 * Builds a specific semantic query for a single STRS finding.
 */
export function buildQueryForFinding(
  finding: FindingBreakdown,
  decoded?: DecodedTransaction,
): RetrievalQuery | null {
  const id = finding.id.toUpperCase();

  if (id.includes("APPROVE") || id === "VS-05") {
    return {
      findingId: finding.id,
      text: "SPL Token Approve instruction authority delegation drain u64 MAX vulnerability",
      category: "token-security",
      instructionType: "Approve",
      tags: ["token", "approve", "delegate", "drain"],
    };
  }

  if (id.includes("ASSIGN")) {
    return {
      findingId: finding.id,
      text: "SystemProgram Assign account owner reassignment security risk",
      category: "solana",
      instructionType: "Assign",
      tags: ["system", "assign", "reassignment"],
    };
  }

  if (id === "VS-06" || id.includes("AUTHORITY")) {
    return {
      findingId: finding.id,
      text: "SPL Token SetAuthority account owner mint freeze authority hijack risk",
      category: "token-security",
      instructionType: "SetAuthority",
      tags: ["token", "set-authority", "hijack"],
    };
  }

  if (id === "VS-07" || id.includes("CLOSE")) {
    return {
      findingId: finding.id,
      text: "SPL Token CloseAccount rent lamports recovery destination verification",
      category: "token-security",
      instructionType: "CloseAccount",
      tags: ["token", "close-account", "rent"],
    };
  }

  if (id === "VS-02" || id.includes("UNKNOWN")) {
    return {
      findingId: finding.id,
      text: "Solana on-chain program verification unverified custom program ID risk",
      category: "programs",
      tags: ["unverified", "program", "verification"],
    };
  }

  if (id.includes("MEMO") || (finding.explanation && finding.explanation.toLowerCase().includes("memo"))) {
    return {
      findingId: finding.id,
      text: "Solana SPL Memo program arbitrary user input prompt injection defense",
      category: "programs",
      instructionType: "Memo",
      tags: ["memo", "prompt-injection"],
    };
  }

  if (id.includes("SIM") || id === "VS-08-ERR") {
    return {
      findingId: finding.id,
      text: "Solana RPC transaction simulation limitations blockhash expiry mock balance failures",
      category: "transaction-security",
      tags: ["simulation", "rpc", "limitations"],
    };
  }

  if (id === "VS-01") {
    return {
      findingId: finding.id,
      text: "SystemProgram transfer large SOL lamports transfer drain protection",
      category: "solana",
      instructionType: "Transfer",
      tags: ["transfer", "sol", "system"],
    };
  }

  // Fallback query derived from finding explanation
  return {
    findingId: finding.id,
    text: `Solana security ${finding.explanation}`,
    tags: ["security"],
  };
}

/**
 * Builds a query for an instruction when no specific findings exist.
 */
function buildQueryForInstruction(ix: any): RetrievalQuery | null {
  const type = (ix.data as any)?.type;
  if (type === "transfer" || type === "Transfer") {
    return {
      text: "Solana SystemProgram and SPL Token transfer security best practices",
      category: "solana",
      instructionType: "Transfer",
    };
  }
  if (type === "approve" || type === "Approve") {
    return {
      text: "SPL Token Approve delegation security",
      category: "token-security",
      instructionType: "Approve",
    };
  }
  return null;
}
