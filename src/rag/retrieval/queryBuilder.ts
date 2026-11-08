// src/rag/retrieval/queryBuilder.ts
import type { RetrievalQuery } from "../types";
import type { DecodedTransaction } from "../../solana/transactionDecoder";
import type { FindingBreakdown } from "../../solana/transactionRiskScore";

/**
 * Constructs targeted security retrieval queries based on deterministic STRS findings,
 * decoded instruction data, program IDs, account relationships, and simulation evidence.
 *
 * Never includes private keys, seed phrases, or sensitive wallet secrets in queries.
 * Never outputs a generic query like "security".
 */
export function buildQueriesForFindings(
  findings: FindingBreakdown[],
  decoded?: DecodedTransaction,
  simulation?: any,
): RetrievalQuery[] {
  const queries: RetrievalQuery[] = [];

  // 1. Build queries from each deterministic STRS finding
  for (const finding of findings) {
    const query = buildQueryForFinding(finding, decoded);
    if (query) {
      queries.push(query);
    }
  }

  // 2. Incorporate simulation findings if simulation failed or produced errors
  if (simulation && (simulation.status === "failed" || simulation.error)) {
    const errorMsg = simulation.errorMessage || simulation.error || "Simulation reverted";
    const recentLogs = Array.isArray(simulation.logs) ? simulation.logs.slice(-2).join(" ") : "";
    queries.push({
      findingId: "VS-08-ERR",
      text: `Solana transaction simulation reverted failure: ${errorMsg} ${recentLogs}`.trim(),
      category: "transaction-security",
      tags: ["simulation", "revert", "error", "rpc"],
    });
  }

  // 3. If no findings or no queries generated, build context queries from actual decoded instructions & program IDs
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
 * Builds a specific semantic query for a single STRS finding, incorporating:
 * - Detected program IDs
 * - Instruction types
 * - STRS finding identifiers
 * - Finding descriptions
 * - Relevant account relationships (e.g. delegate, owner, newAuthority, destination)
 * - Token program type (SPL Token vs Token-2022)
 */
export function buildQueryForFinding(
  finding: FindingBreakdown,
  decoded?: DecodedTransaction,
): RetrievalQuery | null {
  const id = finding.id.toUpperCase();

  // Check if Token-2022 is involved in this transaction
  const isToken2022 = Boolean(
    decoded?.instructions.some(
      (ix) =>
        ix.programName === "Token2022Program" ||
        ix.programId === "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
    ),
  );

  const tokenContext = isToken2022 ? "Token-2022 extensions" : "SPL Token";

  // VS-05-APPROVE: Token delegation / drain
  if (id.includes("APPROVE") || id === "VS-05-APPROVE") {
    const delegate = finding.evidence?.delegate ? `delegate ${finding.evidence.delegate}` : "";
    const owner = finding.evidence?.owner ? `owner ${finding.evidence.owner}` : "";
    return {
      findingId: finding.id,
      text: `${tokenContext} Approve instruction authority delegation drain u64 MAX vulnerability ${delegate} ${owner}`.trim(),
      category: "token-security",
      instructionType: "Approve",
      tags: ["token", "approve", "delegate", "drain", isToken2022 ? "token-2022" : "spl-token"],
    };
  }

  // VS-06-ASSIGN: SystemProgram account owner reassignment
  if (id.includes("ASSIGN")) {
    const accounts = finding.affectedAccounts?.slice(0, 2).join(" ") ?? "";
    return {
      findingId: finding.id,
      text: `SystemProgram Assign account owner reassignment security risk ${accounts}`.trim(),
      category: "solana",
      instructionType: "Assign",
      tags: ["system", "assign", "reassignment", "ownership"],
    };
  }

  // VS-06: SetAuthority account / mint hijack
  if (id === "VS-06" || id.includes("AUTHORITY")) {
    const authType = finding.evidence?.authorityType ? `type ${finding.evidence.authorityType}` : "";
    const newAuth = finding.evidence?.newAuthority ? `new authority ${finding.evidence.newAuthority}` : "";
    return {
      findingId: finding.id,
      text: `${tokenContext} SetAuthority account owner mint freeze authority hijack risk ${authType} ${newAuth}`.trim(),
      category: "token-security",
      instructionType: "SetAuthority",
      tags: ["token", "set-authority", "hijack", isToken2022 ? "token-2022" : "spl-token"],
    };
  }

  // VS-07: CloseAccount rent draining
  if (id === "VS-07" || id.includes("CLOSE")) {
    const destination = finding.evidence?.rentDestination ? `destination ${finding.evidence.rentDestination}` : "";
    return {
      findingId: finding.id,
      text: `${tokenContext} CloseAccount rent lamports recovery destination verification ${destination}`.trim(),
      category: "token-security",
      instructionType: "CloseAccount",
      tags: ["token", "close-account", "rent", isToken2022 ? "token-2022" : "spl-token"],
    };
  }

  // VS-02: Unverified program interaction
  if (id === "VS-02" || id.includes("UNKNOWN")) {
    const unverifiedIds = Array.isArray(finding.evidence?.unverifiedProgramIds)
      ? finding.evidence.unverifiedProgramIds.join(" ")
      : finding.affectedAccounts?.join(" ") ?? "";
    return {
      findingId: finding.id,
      text: `Solana on-chain program verification unverified custom program ID risk ${unverifiedIds}`.trim(),
      category: "programs",
      tags: ["unverified", "program", "verification"],
    };
  }

  // Memo prompt injection defense
  if (id.includes("MEMO") || (finding.explanation && finding.explanation.toLowerCase().includes("memo"))) {
    return {
      findingId: finding.id,
      text: "Solana SPL Memo program arbitrary user input prompt injection defense",
      category: "programs",
      instructionType: "Memo",
      tags: ["memo", "prompt-injection"],
    };
  }

  // VS-08-ERR / Simulation error
  if (id.includes("SIM") || id === "VS-08-ERR") {
    return {
      findingId: finding.id,
      text: `Solana RPC transaction simulation limitations blockhash expiry mock balance failures ${finding.explanation}`.trim(),
      category: "transaction-security",
      tags: ["simulation", "rpc", "limitations"],
    };
  }

  // VS-01 / VS-01-MULTI: Large or batch SOL transfers
  if (id === "VS-01" || id.includes("MULTI")) {
    const accounts = finding.affectedAccounts?.slice(0, 2).join(" ") ?? "";
    return {
      findingId: finding.id,
      text: `SystemProgram transfer large SOL lamports transfer drain protection ${accounts}`.trim(),
      category: "solana",
      instructionType: "Transfer",
      tags: ["transfer", "sol", "system"],
    };
  }

  // VS-04-LUT: Unresolved address lookup tables
  if (id.includes("LUT")) {
    return {
      findingId: finding.id,
      text: "Solana v0 versioned transaction address lookup table resolution bounds",
      category: "solana",
      tags: ["lookup-table", "versioned", "v0"],
    };
  }

  // Fallback query derived from finding description and explanation
  return {
    findingId: finding.id,
    text: `Solana security finding ${finding.id} ${finding.description}: ${finding.explanation}`.trim(),
    tags: ["security", finding.dimension || "general"],
  };
}

/**
 * Builds a query for an instruction when no specific findings exist,
 * based on the detected program ID and instruction type.
 */
function buildQueryForInstruction(ix: any): RetrievalQuery | null {
  const programName = ix.programName || ix.programId;
  const type = (ix.data as any)?.type || (ix.data as any)?.instruction || "";

  if (type) {
    return {
      text: `Solana ${programName} ${type} instruction security best practices`,
      category: programName.includes("Token") ? "token-security" : "solana",
      instructionType: type,
      tags: [programName.toLowerCase(), String(type).toLowerCase()],
    };
  }

  return {
    text: `Solana program ${ix.programId} interaction verification`,
    category: "programs",
    tags: ["program", "verification"],
  };
}
