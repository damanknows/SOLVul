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
];

/**
 * Sanitizes untrusted text by neutralizing injection patterns and stripping control characters.
 */
export function sanitizeUntrustedContent(raw: string): string {
  if (!raw) return "";

  let cleaned = String(raw).replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F]/g, "");

  for (const pattern of INJECTION_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[FILTERED_INSTRUCTION]");
  }

  // Prevent markdown / codeblock breakouts
  cleaned = cleaned.replace(/```/g, "'''");

  return cleaned.trim();
}

/**
 * Wraps a retrieved excerpt into an explicit untrusted reference container
 * with provenance tags.
 */
export function wrapUntrustedExcerpt(
  excerpt: string,
  docId: string,
  title: string,
): { documentId: string; title: string; content: string } {
  const sanitized = sanitizeUntrustedContent(excerpt);
  return {
    documentId: docId,
    title: sanitizeUntrustedContent(title),
    content: sanitized,
  };
}
