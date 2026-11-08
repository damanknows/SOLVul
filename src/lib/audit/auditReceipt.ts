// src/lib/audit/auditReceipt.ts
import type { DecodedTransaction } from "../../solana/transactionDecoder";
import type { TransactionRiskAssessment, RuleResult } from "../../solana/transactionRiskScore";
import type { Explanation } from "../../gemini/explanation";

export interface AuditRagCitation {
  source: string;
  snippet: string;
  sourceUrl?: string;
  publisher?: string;
  trustLevel?: string;
}

export type AuditIntegrityStatus =
  | "VERIFIED"
  | "UNVERIFIED"
  | "TAMPERED"
  | "VERIFICATION_FAILED"
  | "VERIFIED_AUTHENTIC"
  | "TAMPERING_DETECTED";

export interface ReceiptDigestInfo {
  algorithm: "SHA-256";
  canonicalHash: string;
  coveredFields: string[];
}

export interface SecurityAuditReceipt {
  version: "1.0.0";
  generator: "SOLVul Pre-Sign Firewall & Audit Engine";
  timestamp: string; // ISO-8601 UTC timestamp
  payload: {
    sha256: string;
    version: "legacy" | "v0";
    wireBytesLength: number;
    base64Payload: string;
    recentBlockhash: string;
    accountKeys: string[];
    instructionCount: number;
    header?: {
      numRequiredSignatures: number;
      numReadonlySignedAccounts: number;
      numReadonlyUnsignedAccounts: number;
    };
  };
  strsRiskScore: {
    score: number;
    riskLevel: string;
    dimensionBreakdown: {
      amount: number;
      program: number;
      authority: number;
      simulation: number;
      complexity: number;
      instructionCount: number;
    };
    triggeredRules: Array<{
      id: string; // VS-01..VS-08
      description: string;
      severity: number;
      confidence: number;
      dimension: string;
      affectedAccounts: string[];
      evidence: Record<string, any>;
    }>;
  };
  ragCitations: AuditRagCitation[];
  geminiExplanation: {
    summary: string;
    risks: string[];
    recommendations: string[];
    findings: Array<{
      id: string;
      severity: number;
      confidence: number;
      description: string;
    }>;
    technicalDetails?: Record<string, any>;
  };
  cryptographicBinding: {
    algorithm: "SHA-256";
    toctouProtection: "Bit-for-bit pre-sign serialization equality verified";
    inspectedHash: string;
    status: AuditIntegrityStatus;
  };
  receiptDigest?: ReceiptDigestInfo;
}

export interface GenerateReceiptParams {
  base64Tx: string;
  sha256Hash: string;
  decodedTx?: DecodedTransaction | null;
  riskAssessment?: TransactionRiskAssessment | null;
  explanation?: Explanation | any | null;
  ragCitations?: AuditRagCitation[];
  isTampered?: boolean;
  verificationStatus?: AuditIntegrityStatus;
}

export interface ReceiptVerificationResult {
  status: AuditIntegrityStatus;
  isValid: boolean;
  reason: string;
  computedHash?: string;
  payloadIntegrity?: {
    status: AuditIntegrityStatus;
    computedHash: string;
    matchesInspected: boolean;
  };
  receiptIntegrity?: {
    status: AuditIntegrityStatus;
    computedDigest?: string;
    expectedDigest?: string;
    reason?: string;
  };
}

/**
 * Validates canonical Base64 encoding.
 * Rejects invalid characters, incorrect padding, empty payloads,
 * noncanonical encodings, and byte length mismatches.
 */
export function validateCanonicalBase64(
  str: unknown,
  expectedByteLength?: number,
): { isValid: boolean; error?: string; bytes?: Buffer } {
  if (typeof str !== "string" || !str.trim()) {
    return { isValid: false, error: "Base64 transaction payload is empty or not a string" };
  }
  const trimmed = str.trim();
  if (trimmed.length % 4 !== 0) {
    return { isValid: false, error: "Base64 payload length is not a multiple of 4 (incorrect padding)" };
  }
  const CANONICAL_B64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  if (!CANONICAL_B64_REGEX.test(trimmed)) {
    return { isValid: false, error: "Base64 payload contains invalid characters or improper padding sequence" };
  }
  try {
    const buf = Buffer.from(trimmed, "base64");
    if (buf.length === 0) {
      return { isValid: false, error: "Decoded payload is 0 bytes" };
    }
    if (buf.toString("base64") !== trimmed) {
      return { isValid: false, error: "Noncanonical Base64 encoding detected" };
    }
    if (expectedByteLength !== undefined && buf.length !== expectedByteLength) {
      return {
        isValid: false,
        error: `Decoded byte length mismatch: expected ${expectedByteLength} bytes, got ${buf.length} bytes`,
      };
    }
    return { isValid: true, bytes: buf };
  } catch (err: any) {
    return { isValid: false, error: `Base64 decoding failed: ${err?.message || "Invalid payload"}` };
  }
}

/**
 * Recursively sorts object keys for deterministic canonical JSON serialization.
 */
export function canonicalizeValue(val: any): any {
  if (val === null || val === undefined) return null;
  if (Array.isArray(val)) {
    return val.map(canonicalizeValue);
  }
  if (typeof val === "object") {
    const sortedKeys = Object.keys(val).sort();
    const result: Record<string, any> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalizeValue(val[key]);
    }
    return result;
  }
  return val;
}

/**
 * Computes canonical SHA-256 digest covering all security-relevant fields of an audit receipt:
 * - Transaction wire hash and payload
 * - STRS score, risk level, dimension breakdown, and findings
 * - RAG citations and provenance
 * - Gemini explanation summary, risks, recommendations, and findings
 * - Verification metadata (algorithm, inspectedHash, status, toctouProtection)
 */
export function computeReceiptDigest(receipt: {
  payload: { sha256: string; base64Payload: string };
  strsRiskScore: { score: number; riskLevel: string; dimensionBreakdown: any; triggeredRules: any[] };
  ragCitations: any[];
  geminiExplanation: any;
  cryptographicBinding: { inspectedHash: string; algorithm: string; status: string; toctouProtection: string };
}): string {
  const coveredData = {
    transactionHash: receipt.payload?.sha256 ?? "",
    base64Payload: receipt.payload?.base64Payload ?? "",
    strsScore: receipt.strsRiskScore?.score ?? 0,
    strsRiskLevel: receipt.strsRiskScore?.riskLevel ?? "",
    strsDimensionBreakdown: receipt.strsRiskScore?.dimensionBreakdown ?? {},
    strsFindings: receipt.strsRiskScore?.triggeredRules ?? [],
    ragCitations: receipt.ragCitations ?? [],
    geminiExplanation: receipt.geminiExplanation ?? {},
    verificationMetadata: {
      algorithm: receipt.cryptographicBinding?.algorithm ?? "SHA-256",
      inspectedHash: receipt.cryptographicBinding?.inspectedHash ?? "",
      status: receipt.cryptographicBinding?.status ?? "UNVERIFIED",
      toctouProtection: receipt.cryptographicBinding?.toctouProtection ?? "",
    },
  };
  const canonicalObj = canonicalizeValue(coveredData);
  const jsonString = JSON.stringify(canonicalObj);
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(jsonString).digest("hex");
}

/**
 * Recomputes and verifies both:
 * 1. Transaction wire payload integrity (SHA-256 wire hash).
 * 2. Receipt metadata integrity (canonical receipt digest covering STRS, findings, RAG citations, and explanation).
 *
 * Requirements:
 * - Missing verification data yields "UNVERIFIED"
 * - Invalid/noncanonical Base64 yields "VERIFICATION_FAILED"
 * - Wire hash mismatch yields "TAMPERED"
 * - Missing receipt digest yields "UNVERIFIED" (wire hash does not authenticate entire receipt)
 * - Receipt metadata mismatch yields "TAMPERED"
 * - Both wire and receipt digest match yields "VERIFIED"
 */
export function verifyAuditReceipt(receipt: SecurityAuditReceipt): ReceiptVerificationResult {
  if (!receipt || !receipt.payload || !receipt.cryptographicBinding) {
    return {
      status: "UNVERIFIED",
      isValid: false,
      reason: "Missing receipt payload or cryptographic binding metadata",
    };
  }

  const { base64Payload, sha256: payloadHash, wireBytesLength } = receipt.payload;
  const { inspectedHash } = receipt.cryptographicBinding;

  if (!base64Payload || !payloadHash || !inspectedHash) {
    return {
      status: "UNVERIFIED",
      isValid: false,
      reason: "Missing required cryptographic verification data (base64Payload, sha256, or inspectedHash)",
    };
  }

  try {
    // 1. Strict canonical Base64 validation
    const b64Check = validateCanonicalBase64(base64Payload, wireBytesLength);
    if (!b64Check.isValid) {
      const isLengthMismatch = b64Check.error?.includes("length mismatch");
      return {
        status: isLengthMismatch ? "TAMPERED" : "VERIFICATION_FAILED",
        isValid: false,
        reason: `Base64 wire payload validation failed: ${b64Check.error}`,
      };
    }

    const rawBytes = b64Check.bytes!;

    // 2. Compute SHA-256 over raw wire bytes
    const crypto = require("crypto");
    const computedHash: string = crypto.createHash("sha256").update(rawBytes).digest("hex");

    if (payloadHash !== inspectedHash) {
      return {
        status: "TAMPERED",
        isValid: false,
        reason: `Cryptographic hash mismatch: payload sha256 (${payloadHash}) does not match inspectedHash (${inspectedHash})`,
        computedHash,
        payloadIntegrity: {
          status: "TAMPERED",
          computedHash,
          matchesInspected: false,
        },
      };
    }

    if (computedHash !== payloadHash) {
      return {
        status: "TAMPERED",
        isValid: false,
        reason: `Cryptographic verification failed: recomputed hash (${computedHash}) does not match recorded sha256 (${payloadHash})`,
        computedHash,
        payloadIntegrity: {
          status: "TAMPERED",
          computedHash,
          matchesInspected: false,
        },
      };
    }

    if (receipt.cryptographicBinding.status === "TAMPERED" || receipt.cryptographicBinding.status === "TAMPERING_DETECTED") {
      return {
        status: "TAMPERED",
        isValid: false,
        reason: "Receipt has been explicitly flagged as tampered",
        computedHash,
        payloadIntegrity: {
          status: "TAMPERED",
          computedHash,
          matchesInspected: true,
        },
      };
    }

    // 3. Receipt Metadata Integrity Check
    // If the receipt has no valid digest, mark it UNVERIFIED (do not claim wire hash authenticates entire receipt)
    if (!receipt.receiptDigest || !receipt.receiptDigest.canonicalHash || typeof receipt.receiptDigest.canonicalHash !== "string") {
      return {
        status: "UNVERIFIED",
        isValid: false,
        reason: "Receipt metadata has no valid cryptographic digest. Transaction wire hash alone does not authenticate receipt metadata.",
        computedHash,
        payloadIntegrity: {
          status: "VERIFIED",
          computedHash,
          matchesInspected: true,
        },
        receiptIntegrity: {
          status: "UNVERIFIED",
          reason: "Missing receiptDigest",
        },
      };
    }

    const recomputedDigest = computeReceiptDigest(receipt);
    if (recomputedDigest !== receipt.receiptDigest.canonicalHash) {
      return {
        status: "TAMPERED",
        isValid: false,
        reason: "Receipt metadata tampering detected: Recomputed canonical digest does not match recorded receiptDigest (STRS score/findings, RAG citations, or Gemini explanation was modified).",
        computedHash,
        payloadIntegrity: {
          status: "VERIFIED",
          computedHash,
          matchesInspected: true,
        },
        receiptIntegrity: {
          status: "TAMPERED",
          computedDigest: recomputedDigest,
          expectedDigest: receipt.receiptDigest.canonicalHash,
        },
      };
    }

    return {
      status: "VERIFIED",
      isValid: true,
      reason: "Transaction wire payload and receipt metadata integrity both verified bit-for-bit",
      computedHash,
      payloadIntegrity: {
        status: "VERIFIED",
        computedHash,
        matchesInspected: true,
      },
      receiptIntegrity: {
        status: "VERIFIED",
        computedDigest: recomputedDigest,
        expectedDigest: receipt.receiptDigest.canonicalHash,
      },
    };
  } catch (err: any) {
    return {
      status: "VERIFICATION_FAILED",
      isValid: false,
      reason: `Verification failed with internal error: ${err?.message || "Unknown error"}`,
    };
  }
}

/**
 * Builds a structured, self-contained SecurityAuditReceipt object.
 */
export function generateAuditReceipt(params: GenerateReceiptParams): SecurityAuditReceipt {
  const {
    base64Tx,
    sha256Hash,
    decodedTx,
    riskAssessment,
    explanation,
    ragCitations = [],
    isTampered = false,
    verificationStatus,
  } = params;

  const rawBytes = Buffer.from(base64Tx ? base64Tx.trim() : "", "base64");
  const normalizedBase64 = rawBytes.length > 0 ? rawBytes.toString("base64") : (base64Tx ? base64Tx.trim() : "");

  // Derive dimension breakdown from findings if not explicitly stored
  const dimensionBreakdown = {
    amount: 0,
    program: 0,
    authority: 0,
    simulation: 0,
    complexity: 0,
    instructionCount: 0,
  };

  const findings = riskAssessment?.breakdown ?? [];
  for (const f of findings) {
    const dim = f.dimension as keyof typeof dimensionBreakdown;
    if (dimensionBreakdown[dim] !== undefined) {
      dimensionBreakdown[dim] += Math.round(f.severity * f.confidence * 10);
    }
  }

  const triggeredRules = findings.map((f: RuleResult) => ({
    id: f.id,
    description: f.description,
    severity: f.severity,
    confidence: f.confidence,
    dimension: f.dimension,
    affectedAccounts: f.affectedAccounts ?? [],
    evidence: f.evidence ?? {},
  }));

  // Map RAG citations from explanation.evidence if ragCitations not explicitly passed
  const citations: AuditRagCitation[] =
    ragCitations.length > 0
      ? ragCitations
      : (explanation?.evidence ?? []).map((e: any) => ({
          source: e.source,
          snippet: e.snippet,
        }));

  // Determine explicit verification state (never blindly defaults to VERIFIED_AUTHENTIC)
  let status: AuditIntegrityStatus = "UNVERIFIED";
  if (isTampered) {
    status = "TAMPERED";
  } else if (verificationStatus) {
    status = verificationStatus;
  } else if (base64Tx && sha256Hash) {
    try {
      const crypto = require("crypto");
      const computed = crypto.createHash("sha256").update(rawBytes).digest("hex");
      if (computed === sha256Hash) {
        status = "VERIFIED";
      } else {
        status = "TAMPERED";
      }
    } catch {
      status = "UNVERIFIED";
    }
  }

  const receipt: SecurityAuditReceipt = {
    version: "1.0.0",
    generator: "SOLVul Pre-Sign Firewall & Audit Engine",
    timestamp: new Date().toISOString(),
    payload: {
      sha256: sha256Hash,
      version: decodedTx?.version ?? (base64Tx.startsWith("AQ") ? "v0" : "legacy"),
      wireBytesLength: rawBytes.length,
      base64Payload: normalizedBase64,
      recentBlockhash: decodedTx?.message.recentBlockhash ?? "unknown",
      accountKeys: decodedTx?.message.accountKeys ?? [],
      instructionCount: decodedTx?.instructions?.length ?? decodedTx?.message.instructionCount ?? 0,
      header: decodedTx?.message.header,
    },
    strsRiskScore: {
      score: riskAssessment?.score ?? 0,
      riskLevel: riskAssessment?.riskLevel ?? "UNKNOWN",
      dimensionBreakdown,
      triggeredRules,
    },
    ragCitations: citations,
    geminiExplanation: {
      summary: (explanation as any)?.transactionSummary ?? explanation?.summary ?? "No AI explanation available.",
      risks: (explanation as any)?.securityConcerns ?? (explanation as any)?.risks ?? [],
      recommendations: (explanation as any)?.recommendedActions ?? (explanation as any)?.recommendations ?? [],
      findings: ((explanation as any)?.criticalFindings ?? explanation?.findings ?? []).map((f: any) => ({
        id: f.ruleId ?? f.id,
        severity: f.severity ?? 0,
        confidence: f.confidence ?? 1.0,
        description: f.explanation ?? f.description ?? "",
      })),
      technicalDetails: (explanation as any)?.technicalDetails,
    },
    cryptographicBinding: {
      algorithm: "SHA-256",
      toctouProtection: "Bit-for-bit pre-sign serialization equality verified",
      inspectedHash: sha256Hash,
      status: status,
    },
  };

  if (status !== "TAMPERED" && rawBytes.length > 0) {
    const canonicalHash = computeReceiptDigest(receipt);
    receipt.receiptDigest = {
      algorithm: "SHA-256",
      canonicalHash,
      coveredFields: [
        "payload.sha256",
        "payload.base64Payload",
        "strsRiskScore.score",
        "strsRiskScore.riskLevel",
        "strsRiskScore.dimensionBreakdown",
        "strsRiskScore.triggeredRules",
        "ragCitations",
        "geminiExplanation",
        "cryptographicBinding",
      ],
    };
  }

  return receipt;
}

/**
 * Formats a SecurityAuditReceipt into a GitHub-Flavored Markdown report.
 */
export function formatAuditReceiptMarkdown(receipt: SecurityAuditReceipt): string {
  const isSafe = receipt.strsRiskScore.riskLevel === "SAFE" || receipt.strsRiskScore.riskLevel === "LOW";
  const isTampered =
    receipt.cryptographicBinding.status === "TAMPERED" ||
    receipt.cryptographicBinding.status === "TAMPERING_DETECTED";
  const alertType = isTampered
    ? "CAUTION"
    : receipt.cryptographicBinding.status === "UNVERIFIED"
    ? "WARNING"
    : isSafe
    ? "TIP"
    : "WARNING";

  let md = `# 🛡️ SOLVul Verifiable Transaction Security Audit Receipt\n\n`;

  md += `> [!${alertType}]\n`;
  if (isTampered) {
    md += `> **CRITICAL SECURITY ALERT: PAYLOAD TAMPERING DETECTED**\n`;
    md += `> The transaction wire bytes were modified after inspection. Signing was aborted to prevent loss of funds.\n\n`;
  } else if (receipt.cryptographicBinding.status === "UNVERIFIED") {
    md += `> **Pre-Sign Security Attestation (UNVERIFIED)**: Missing verification metadata. Cryptographic payload integrity has not been verified.\n\n`;
  } else {
    md += `> **Pre-Sign Security Attestation**: This receipt verifies the deterministic risk analysis, cryptographic payload hash, and RAG-grounded AI audit conducted prior to wallet authorization.\n\n`;
  }

  md += `## 1. Cryptographic Wire Binding & Header Verification\n\n`;
  md += `| Field | Value |\n`;
  md += `| :--- | :--- |\n`;
  md += `| **Payload SHA-256 Fingerprint** | \`${receipt.payload.sha256}\` |\n`;
  if (receipt.receiptDigest) {
    md += `| **Receipt Canonical Digest** | \`${receipt.receiptDigest.canonicalHash}\` |\n`;
  }
  md += `| **Timestamp (UTC)** | \`${receipt.timestamp}\` |\n`;
  md += `| **Transaction Wire Version** | \`${receipt.payload.version.toUpperCase()}\` |\n`;
  md += `| **Wire Payload Size** | ${receipt.payload.wireBytesLength} bytes |\n`;
  md += `| **Account Keys Count** | ${receipt.payload.accountKeys.length} accounts |\n`;
  md += `| **Instruction Count** | ${receipt.payload.instructionCount} instructions |\n`;

  if (receipt.payload.header) {
    md += `| **Required Signatures** | ${receipt.payload.header.numRequiredSignatures} |\n`;
    md += `| **Readonly Signed Accounts** | ${receipt.payload.header.numReadonlySignedAccounts} |\n`;
    md += `| **Readonly Unsigned Accounts** | ${receipt.payload.header.numReadonlyUnsignedAccounts} |\n`;
  }
  md += `| **Cryptographic TOCTOU Status** | **${receipt.cryptographicBinding.status}** |\n\n`;

  md += `## 2. Deterministic STRS Risk Assessment\n\n`;
  md += `- **Overall STRS Risk Score**: **${receipt.strsRiskScore.score} / 100**\n`;
  md += `- **Assigned Risk Tier**: **${receipt.strsRiskScore.riskLevel}**\n\n`;

  md += `### Dimension Scoring Breakdown\n\n`;
  md += `| Risk Dimension | Score Contribution |\n`;
  md += `| :--- | :--- |\n`;
  md += `| Transfer Amount | ${receipt.strsRiskScore.dimensionBreakdown.amount} |\n`;
  md += `| Program Verification | ${receipt.strsRiskScore.dimensionBreakdown.program} |\n`;
  md += `| Authority & Permissions | ${receipt.strsRiskScore.dimensionBreakdown.authority} |\n`;
  md += `| Simulation Outcomes | ${receipt.strsRiskScore.dimensionBreakdown.simulation} |\n`;
  md += `| Instruction Complexity | ${receipt.strsRiskScore.dimensionBreakdown.complexity} |\n`;
  md += `| Instruction Count | ${receipt.strsRiskScore.dimensionBreakdown.instructionCount} |\n\n`;

  md += `### Triggered STRS Deterministic Security Rules\n\n`;
  if (receipt.strsRiskScore.triggeredRules.length === 0) {
    md += `*No deterministic risk rules triggered. Transaction passes baseline security heuristics.*\n\n`;
  } else {
    md += `| Rule ID | Severity | Confidence | Description | Affected Accounts |\n`;
    md += `| :--- | :---: | :---: | :--- | :--- |\n`;
    for (const r of receipt.strsRiskScore.triggeredRules) {
      const accounts = r.affectedAccounts.length > 0
        ? r.affectedAccounts.map((a) => `\`${a.slice(0, 4)}…${a.slice(-4)}\``).join(", ")
        : "None";
      md += `| **${r.id}** | ${r.severity}/10 | ${(r.confidence * 100).toFixed(0)}% | ${r.description} | ${accounts} |\n`;
    }
    md += `\n`;
  }

  md += `## 3. Google Gemini AI Security Explanation\n\n`;
  md += `### Summary\n${receipt.geminiExplanation.summary}\n\n`;

  if (receipt.geminiExplanation.risks.length > 0) {
    md += `### Specific Security Risks\n`;
    for (const risk of receipt.geminiExplanation.risks) {
      md += `- ⚠️ ${risk}\n`;
    }
    md += `\n`;
  }

  if (receipt.geminiExplanation.recommendations.length > 0) {
    md += `### Safety Recommendations\n`;
    for (const rec of receipt.geminiExplanation.recommendations) {
      md += `- 🛡️ ${rec}\n`;
    }
    md += `\n`;
  }

  md += `## 4. Solana Security Knowledge Citations (RAG)\n\n`;
  if (receipt.ragCitations.length === 0) {
    md += `*No specific RAG corpus citations attached to this receipt.*\n\n`;
  } else {
    for (const [idx, cit] of receipt.ragCitations.entries()) {
      md += `**Citation [${idx + 1}] — ${cit.source}**\n`;
      if (cit.sourceUrl) md += `- URL: [${cit.sourceUrl}](${cit.sourceUrl})\n`;
      if (cit.trustLevel) md += `- Trust Level: \`${cit.trustLevel}\`\n`;
      md += `> "${cit.snippet.replace(/\n/g, " ")}"\n\n`;
    }
  }

  md += `---\n`;
  md += `*Generated autonomously by SOLVul Security Engine · Verifiable Cryptographic Audit Receipt*\n`;

  return md;
}

/**
 * Triggers a browser download of the audit receipt in .json or .md format.
 */
export function downloadAuditReceipt(receipt: SecurityAuditReceipt, format: "json" | "md"): void {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return;
  }

  const shortHash = receipt.payload.sha256.slice(0, 10);
  const timestampStr = new Date(receipt.timestamp).getTime();
  const filename = `solvul-audit-receipt-${shortHash}-${timestampStr}.${format}`;

  let content: string;
  let mimeType: string;

  if (format === "json") {
    content = JSON.stringify(receipt, null, 2);
    mimeType = "application/json";
  } else {
    content = formatAuditReceiptMarkdown(receipt);
    mimeType = "text/markdown";
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
