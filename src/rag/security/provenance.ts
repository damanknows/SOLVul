// src/rag/security/provenance.ts
import type { TrustLevel, DocumentType, KnowledgeChunk } from "../types";

/**
 * Recognized authoritative and reputable domains for Solana knowledge.
 */
const TRUSTED_DOMAINS = [
  "solana.com",
  "docs.solana.com",
  "spl.solana.com",
  "anchor-lang.com",
  "github.com/solana-labs",
  "github.com/coral-xyz",
  "neodyme.io",
  "ottersec.com",
  "sec3.dev",
];

/**
 * Validates whether a source URL originates from an authorized domain.
 */
export function isTrustedSourceUrl(urlStr?: string): boolean {
  if (!urlStr) return false;
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase();
    return TRUSTED_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith("." + domain),
    );
  } catch {
    return false;
  }
}

/**
 * Validates document metadata and enforces trust levels based on publication provenance.
 */
export function validateDocumentProvenance(meta: {
  title: string;
  sourceUrl?: string;
  publisher?: string;
  documentType: DocumentType;
  trustLevel?: TrustLevel;
}): TrustLevel {
  const isTrustedUrl = isTrustedSourceUrl(meta.sourceUrl);

  if (meta.documentType === "official_docs" && isTrustedUrl) {
    return "authoritative";
  }

  if (meta.documentType === "security_research" || meta.documentType === "audit_report") {
    return isTrustedUrl ? "verified_research" : "community";
  }

  return "community";
}

/**
 * Ensures technical documentation is not misconstrued as absolute proof
 * of malice for an unverified program.
 */
export function formatEvidenceClarification(chunk: KnowledgeChunk): string {
  if (chunk.category === "programs" && chunk.documentType === "official_docs") {
    return "Technical specification note: Unverified program status indicates lack of registration in verified registries, not conclusive evidence of malicious code.";
  }
  return "";
}
