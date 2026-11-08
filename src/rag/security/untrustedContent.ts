// src/rag/security/untrustedContent.ts
/**
 * Security layer to neutralize prompt injection, delimiter breakout,
 * and malicious instructions embedded inside retrieved knowledge chunks or transaction metadata.
 */

const INJECTION_PATTERNS = [
  /SYSTEM\s*:/gi,
  /ASSISTANT\s*:/gi,
  /HUMAN\s*:/gi,
  /USER\s*:/gi,
  /\[\s*INSTRUCTION\s*\]/gi,
  /###\s*INSTRUCTION/gi,
  /IGNORE\s+(ALL\s+)?(PREVIOUS|PRIOR)\s+(INSTRUCTIONS|RULES)/gi,
  /DISREGARD\s+(ALL\s+)?(PREVIOUS|PRIOR|SECURITY)/gi,
  /OVERRIDE\s+SECURITY/gi,
  /OUTPUT\s+(SAFE|0\/100)/gi,
  /YOU\s+ARE\s+NOW\s+A/gi,
  /SET\s+RISK\s+SCORE/gi,
  /FORGET\s+(ALL\s+)?(RULES|INSTRUCTIONS)/gi,
  /NEW\s+ROLE\s*:/gi,
  /ADMIN\s+OVERRIDE/gi,
];

/**
 * Sanitizes untrusted text by neutralizing injection patterns, stripping control characters,
 * and preventing delimiter breakouts.
 */
export function sanitizeUntrustedContent(raw: string): string {
  if (!raw) return "";

  let cleaned = String(raw).replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, "");

  for (const pattern of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[FILTERED_INSTRUCTION]");
  }

  // Prevent markdown / codeblock breakouts
  cleaned = cleaned.replace(/```/g, "'''");

  // Prevent XML / structural delimiter injection breakouts
  cleaned = cleaned.replace(/<\/?(UNTRUSTED_EVIDENCE_EXCERPT|RETRIEVED_CORPUS_EVIDENCE|UNTRUSTED_INSTRUCTION_DATA)[^>]*>/gi, "[FILTERED_TAG]");
  cleaned = cleaned.replace(/\[\/?EVIDENCE_DATA_(START|END)\]/gi, "[FILTERED_DELIMITER]");

  return cleaned.trim();
}

/**
 * Escapes attribute values to prevent quote-based injection, tag breakout,
 * and XML attribute breakout within structural delimiters.
 */
export function escapeStructuralAttribute(val: unknown): string {
  if (val === null || val === undefined) return "";
  const str = String(val);
  // Neutralize prompt-injection tokens and control characters
  const sanitized = sanitizeUntrustedContent(str);
  // XML/attribute character escaping: & -> &amp;, " -> &quot;, ' -> &#39;, < -> &lt;, > -> &gt;
  return sanitized
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Sanitizes URLs to prevent javascript:, data:, or other dangerous schemes in structural attributes.
 */
export function sanitizeSourceUrl(url: unknown): string {
  if (typeof url !== "string" || !url.trim()) return "unknown";
  const trimmed = url.trim();
  // Strip control characters and sanitize
  const clean = sanitizeUntrustedContent(trimmed);
  // Check for dangerous URL schemes
  if (/^(?:javascript|data|vbscript|file):/i.test(clean.replace(/\s+/g, ""))) {
    return "filtered:unsafe-scheme";
  }
  return escapeStructuralAttribute(clean);
}

export interface WrappedUntrustedExcerpt {
  documentId: string;
  title: string;
  sourceUrl?: string;
  trustLevel?: string;
  content: string;
  delimitedText: string;
}

/**
 * Wraps a retrieved excerpt into an explicit untrusted reference container
 * with provenance tags and delimiters.
 * All attributes are structurally escaped to prevent attribute-quote breakout and XML tag injection.
 */
export function wrapUntrustedExcerpt(
  excerpt: string,
  docId: string,
  title: string,
  metadata?: { sourceUrl?: string; trustLevel?: string },
): WrappedUntrustedExcerpt {
  const sanitizedContent = sanitizeUntrustedContent(excerpt);
  const escapedDocId = escapeStructuralAttribute(docId);
  const escapedTitle = escapeStructuralAttribute(title);
  const trustLevel = escapeStructuralAttribute(metadata?.trustLevel || "unverified");
  const sourceUrl = sanitizeSourceUrl(metadata?.sourceUrl);

  const delimitedText = [
    `<UNTRUSTED_EVIDENCE_EXCERPT id="${escapedDocId}" title="${escapedTitle}" trust_level="${trustLevel}" source="${sourceUrl}">`,
    `[EVIDENCE_DATA_START]`,
    sanitizedContent,
    `[EVIDENCE_DATA_END]`,
    `</UNTRUSTED_EVIDENCE_EXCERPT>`,
  ].join("\n");

  return {
    documentId: escapedDocId,
    title: escapedTitle,
    sourceUrl,
    trustLevel,
    content: sanitizedContent,
    delimitedText,
  };
}
