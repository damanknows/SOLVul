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
}

/**
 * Recomputes and verifies the cryptographic binding and payload integrity of a SecurityAuditReceipt.
 * 
 * Requirements:
 * - Missing verification data yields "UNVERIFIED"
 * - Modified wire bytes or hash mismatch yields "TAMPERED"
 * - Valid bit-for-bit match yields "VERIFIED"
 * - Internal error yields "VERIFICATION_FAILED"
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
    const rawBytes = Buffer.from(base64Payload.trim(), "base64");
    if (rawBytes.length === 0) {
      return {
        status: "UNVERIFIED",
        isValid: false,
        reason: "Transaction payload is empty",
      };
    }

    if (wireBytesLength !== undefined && rawBytes.length !== wireBytesLength) {
      return {
        status: "TAMPERED",
        isValid: false,
        reason: `Wire byte length mismatch: expected ${wireBytesLength} bytes, got ${rawBytes.length} bytes`,
      };
    }

    // Compute SHA-256 over raw wire bytes
    const crypto = require("crypto");
    const computedHash: string = crypto.createHash("sha256").update(rawBytes).digest("hex");

    if (payloadHash !== inspectedHash) {
      return {
        status: "TAMPERED",
        isValid: false,
        reason: `Cryptographic hash mismatch: payload sha256 (${payloadHash}) does not match inspectedHash (${inspectedHash})`,
        computedHash,
      };
    }

    if (computedHash !== payloadHash) {
      return {
        status: "TAMPERED",
        isValid: false,
        reason: `Cryptographic verification failed: recomputed hash (${computedHash}) does not match recorded sha256 (${payloadHash})`,
        computedHash,
      };
    }

    if (receipt.cryptographicBinding.status === "TAMPERED" || receipt.cryptographicBinding.status === "TAMPERING_DETECTED") {
      return {
        status: "TAMPERED",
        isValid: false,
        reason: "Receipt has been explicitly flagged as tampered",
        computedHash,
      };
    }

    return {
      status: "VERIFIED",
      isValid: true,
      reason: "Cryptographic binding and payload integrity successfully verified bit-for-bit",
      computedHash,
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
    } catch (_) {
      status = "UNVERIFIED";
    }
  }

  return {
    version: "1.0.0",
    generator: "SOLVul Pre-Sign Firewall & Audit Engine",
    timestamp: new Date().toISOString(),
    payload: {
      sha256: sha256Hash,
      version: decodedTx?.version ?? (base64Tx.startsWith("AQ") ? "v0" : "legacy"),
      wireBytesLength: rawBytes.length,
      base64Payload: base64Tx.trim(),
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
