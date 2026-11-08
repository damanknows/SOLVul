// src/rag/security/provenance.ts
import crypto from "crypto";
import type { TrustLevel, DocumentType, KnowledgeChunk } from "../types";

/**
 * Recognized authoritative and reputable domains for Solana knowledge.
 */
export const TRUSTED_DOMAINS = [
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
  if (!urlStr || typeof urlStr !== "string") return false;
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();

    return TRUSTED_DOMAINS.some((domain) => {
      if (domain.includes("/")) {
        const [domHost, ...domPathParts] = domain.split("/");
        const domPath = "/" + domPathParts.join("/");
        const hostMatches = hostname === domHost || hostname.endsWith("." + domHost);
        return hostMatches && pathname.startsWith(domPath);
      }
      return hostname === domain || hostname.endsWith("." + domain);
    });
  } catch {
    return false;
  }
}

/**
 * Validates document metadata and enforces trust levels based on publication provenance.
 * Self-asserted trustLevel fields from document files are strictly ignored.
 */
export function validateDocumentProvenance(meta: {
  title: string;
  sourceUrl?: string;
  publisher?: string;
  documentType: DocumentType;
  trustLevel?: TrustLevel; // Ignored as self-assertion!
}): TrustLevel {
  const isTrustedUrl = isTrustedSourceUrl(meta.sourceUrl);

  // Only official docs or runtime specs from verified domains can be authoritative
  if ((meta.documentType === "official_docs" || meta.documentType === "runtime_spec") && isTrustedUrl) {
    return "authoritative";
  }

  // Security research or audit reports from verified domains receive verified_research
  if ((meta.documentType === "security_research" || meta.documentType === "audit_report") && isTrustedUrl) {
    return "verified_research";
  }

  // All other documents (including unverified URLs or community submissions) are community trust level
  return "community";
}

/**
 * Verifies that a chunk's content matches its expected SHA-256 content hash.
 */
export function verifyContentHash(content: string, expectedHash?: string): boolean {
  if (!content || !expectedHash) return false;
  const computed = crypto.createHash("sha256").update(content.trim()).digest("hex").toLowerCase();
  return computed === expectedHash.trim().toLowerCase();
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
