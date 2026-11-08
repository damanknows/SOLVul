// src/gemini/explanation.ts
import { z } from "zod";
import type { RuleResult } from "../solana/transactionRiskScore";
import type { RetrievalResult } from "../rag/retriever";

/** Zod schemas for strict validation */
const EvidenceSchema = z.object({
  source: z.string().min(1, "Source must not be empty"),
  uri: z.string().url("URI must be a valid URL"),
  snippet: z.string(),
});

const FindingSchema = z.object({
  id: z.string(),               // VS‑01 … VS‑08
  description: z.string(),
  severity: z.number().min(0).max(10),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string()), // IDs of evidence items supporting this finding
});

const ExplanationSchema = z.object({
  summary: z.string(),
  findings: z.array(FindingSchema),
  evidence: z.array(EvidenceSchema),
  uncertainty: z.string(),
  limitations: z.string(),
});

export type Explanation = z.infer<typeof ExplanationSchema>;

/**
 * Sanitize a piece of retrieved text to discard any prompt‑injection lines.
 * For demo purposes we drop any line that starts with the word "ignore" (case‑insensitive).
 */
function sanitizeSnippet(text: string): string {
  const lines = text.split(/\r?\n/);
  const filtered = lines.filter((l) => !/^\s*ignore\b/i.test(l));
  return filtered.join("\n").trim();
}

/**
 * Generate a deterministic, backend‑only Gemini‑style explanation.
 *
 * - Uses only the supplied STRS findings (`breakdown`) and retrieved evidence.
 * - No LLM calls; the output is templated.
 * - The result is validated against a Zod schema before being returned.
 * - All source references are included; the raw snippet is sanitized.
 */
export function generateExplanation(
  breakdown: RuleResult[],
  retrieved: RetrievalResult[],
): Explanation {
  // Build evidence collection with deterministic IDs (UUID v4 would be overkill – use chunk.id)
  const evidence = retrieved.map((r) => {
    const safeSnippet = sanitizeSnippet(r.chunk.content);
    return {
      source: r.chunk.source,
      uri: r.chunk.uri,
      snippet: safeSnippet,
    };
  });

  // Attach evidence IDs (using the source+uri as a simple deterministic identifier)
  const evidenceIdMap = new Map<string, string>(); // key -> id
  evidence.forEach((e, idx) => {
    const id = `${e.source}:${e.uri}`;
    evidenceIdMap.set(id, id);
  });

  // Filter findings that actually have impact (severity > 0)
  const findings = breakdown
    .filter((f) => f.severity > 0)
    .map((f) => {
      // For now we associate every finding with *all* evidence IDs – a more sophisticated
      // mapping could be performed by analysing the evidence content.
      const allEvidenceIds = Array.from(evidenceIdMap.values());
      return {
        id: f.id,
        description: f.description,
        severity: f.severity,
        confidence: f.confidence,
        evidenceIds: allEvidenceIds,
      };
    });

  const summaryLines: string[] = [];
  if (findings.length === 0) {
    summaryLines.push("No notable risk factors were detected for this transaction.");
  } else {
    summaryLines.push("Risk assessment summary:");
    findings.forEach((f) => {
      summaryLines.push(`- ${f.id}: ${f.description} (severity ${f.severity}, confidence ${f.confidence})`);
    });
  }

  const explanation: Explanation = {
    summary: summaryLines.join(" "),
    findings,
    evidence,
    uncertainty: "The explanation is derived solely from deterministic risk rules and the static documentation corpus; live chain state beyond the supplied transaction metadata is not verified.",
    limitations: "Unknown program IDs are treated as low‑severity; no on‑chain state diff is available; evidence is limited to the indexed documentation corpus and may not cover all edge cases.",
  };

  // Validate with Zod – will throw if the object does not conform.
  ExplanationSchema.parse(explanation);

  return explanation;
}

export default generateExplanation;

