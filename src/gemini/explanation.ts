// src/gemini/explanation.ts
import { z } from "zod";
import type { RuleResult } from "../solana/transactionRiskScore";
import type { RetrievalResult } from "../rag/retriever";
import { getGeminiClient, getGeminiModel } from "./client";
import { GEMINI_SYSTEM_INSTRUCTION, buildGeminiPrompt } from "./prompts";
import { GeminiAnalysisInputSchema, GeminiExplanationSchema } from "./schemas";
import type { GeminiAnalysisInput, GeminiExplanation } from "./types";
import { GeminiApiError, GeminiConfigError, GeminiValidationError } from "./errors";

export * from "./types";
export * from "./schemas";
export * from "./errors";
export * from "./prompts";
export * from "./client";

/**
 * Options for generating security explanations.
 */
export interface GeminiExplanationOptions {
  timeoutMs?: number;
  apiKey?: string;
  model?: string;
  client?: any; // For dependency injection in tests
}

/**
 * Generate a comprehensive deterministic fallback explanation when Gemini
 * is unconfigured, times out, encounters a rate limit, or returns invalid data.
 */
export function createDeterministicFallback(
  input: GeminiAnalysisInput,
  diagnosticReason?: string,
): GeminiExplanation {
  // 1. Transaction Summary
  const instructionCount = input.instructions.length;
  const programNames = Array.from(
    new Set(input.instructions.map((ix) => ix.programName || ix.programId)),
  );
  const summary = instructionCount === 0
    ? "Empty transaction with no instructions."
    : `Transaction executing ${instructionCount} instruction(s) across program(s): ${programNames.join(", ")}.`;

  // 2. Risk Explanation
  let riskExplanation = `STRS evaluated this transaction at risk level ${input.riskLevel} (score: ${input.riskScore}/100) with ${(input.confidence * 100).toFixed(0)}% confidence.`;
  if (input.findings.length === 0) {
    riskExplanation += " No adverse security risk rules were triggered.";
  } else {
    riskExplanation += ` Triggered ${input.findings.length} deterministic rule finding(s).`;
  }

  // 3. Critical Findings
  const criticalFindings = input.findings
    .filter((f) => Number(f.severity) > 0)
    .map((f) => {
      // Link to any matching retrieved document
      const matchingDoc = input.retrievedEvidence.find((e) =>
        e.title.toLowerCase().includes(f.ruleId.toLowerCase()) ||
        e.excerpt.toLowerCase().includes(f.ruleId.toLowerCase()),
      );
      return {
        ruleId: f.ruleId,
        explanation: f.explanation,
        evidenceReferenceIds: matchingDoc ? [matchingDoc.documentId] : [],
      };
    });

  // 4. Affected Assets
  const affectedAssetsSet = new Set<string>();
  for (const ix of input.instructions) {
    if (ix.decodedData && typeof ix.decodedData === "object") {
      const data = ix.decodedData as any;
      if (data.solEquivalent !== undefined) affectedAssetsSet.add(`${data.solEquivalent} SOL`);
      if (data.formattedTokenAmount !== undefined) affectedAssetsSet.add(`${data.formattedTokenAmount} tokens`);
      if (data.amount !== undefined && !data.formattedTokenAmount) affectedAssetsSet.add(`Amount: ${data.amount}`);
    }
    for (const acc of ix.accounts) {
      affectedAssetsSet.add(acc);
    }
  }

  // 5. Security Concerns
  const securityConcerns = input.findings
    .filter((f) => Number(f.severity) >= 4)
    .map((f) => `[${f.ruleId}] ${f.explanation}`);

  if (securityConcerns.length === 0 && input.riskScore === 0) {
    securityConcerns.push("No notable security threats detected by deterministic rules.");
  }

  // 6. Recommended Actions
  const recommendedActions = input.findings
    .filter((f) => Number(f.severity) >= 4)
    .map((f) => `Verify account addresses and intended operations for finding ${f.ruleId}`);

  if (recommendedActions.length === 0) {
    recommendedActions.push("Verify recipient address and transaction parameters before signing.");
  }

  // 7. Simulation Interpretation
  let simulationInterpretation = `Simulation status: ${input.simulation.status}.`;
  if (input.simulation.error) {
    simulationInterpretation += ` Simulation error reported: ${JSON.stringify(input.simulation.error)}. Note: simulation failure is not proof of malice.`;
  } else if (input.simulation.status === "success") {
    simulationInterpretation += " Simulation completed without runtime errors on Devnet.";
  } else {
    simulationInterpretation += " Simulation results are unavailable or partial.";
  }

  // 8. Limitations
  const limitations = [
    "Deterministic fallback mode: explanation derived from local inspection rules without generative synthesis.",
    ...input.simulation.limitations,
  ];

  // 9. Evidence References
  const evidenceReferences = input.retrievedEvidence.map((e) => ({
    documentId: e.documentId,
    reason: `Document references guidance relevant to transaction patterns: ${e.title}`,
  }));

  const fallback: GeminiExplanation = {
    transactionSummary: summary,
    riskExplanation,
    criticalFindings,
    affectedAssets: Array.from(affectedAssetsSet).slice(0, 10),
    securityConcerns,
    recommendedActions,
    simulationInterpretation,
    limitations,
    evidenceReferences,
    isFallback: true,
    diagnosticMessage: diagnosticReason,
  };

  return fallback;
}

/**
 * Main Google Gemini Security Explanation Engine.
 *
 * Performs a real API integration with `@google/genai` to generate
 * an evidence-grounded security explanation of deterministic STRS results.
 *
 * Enforces strict boundaries:
 * - Deterministic STRS score is authoritative and immutable.
 * - Model output is schema-validated via Zod.
 * - Any failure (timeout, rate limit, parse error) safely yields a deterministic fallback.
 */
export async function generateSecurityExplanation(
  rawInput: GeminiAnalysisInput,
  options?: GeminiExplanationOptions,
): Promise<GeminiExplanation> {
  // Validate input schema
  const input = GeminiAnalysisInputSchema.parse(rawInput);

  const timeoutMs = options?.timeoutMs ?? 10_000;
  const modelName = options?.model ?? getGeminiModel();

  // If no Gemini API key is available, return deterministic fallback directly
  const apiKey = (options?.apiKey || process.env.GEMINI_API_KEY)?.trim();
  if (!apiKey && !options?.client) {
    return createDeterministicFallback(input, "GEMINI_API_KEY is not configured on the server");
  }

  try {
    const client = options?.client ?? getGeminiClient(apiKey);
    const prompt = buildGeminiPrompt(input);

    // Call Gemini with timeout race
    const generatePromise = client.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        systemInstruction: GEMINI_SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
      },
    });

    let timeoutTimer: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutTimer = setTimeout(() => {
        reject(new GeminiApiError(`Gemini request timed out after ${timeoutMs}ms`, { isTimeout: true }));
      }, timeoutMs);
    });

    let response: any;
    try {
      response = await Promise.race([generatePromise, timeoutPromise]);
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
    }

    const rawText = response.text;

    if (!rawText || !rawText.trim()) {
      throw new GeminiValidationError("Gemini returned empty response text");
    }

    // Strip any markdown code fences if model enclosed in ```json ... ```
    const cleanedJson = rawText
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(cleanedJson);
    } catch (parseErr: any) {
      throw new GeminiValidationError(`Failed to parse Gemini response as JSON: ${parseErr.message}`, rawText);
    }

    // Validate with strict Zod schema
    const validated = GeminiExplanationSchema.parse(parsedJson);

    // Integrity Check: ensure Gemini did not erase high-severity deterministic findings
    const disagreements: string[] = [];
    for (const finding of input.findings) {
      if (Number(finding.severity) >= 7) {
        const found = validated.criticalFindings.some(
          (cf) => cf.ruleId.toLowerCase() === finding.ruleId.toLowerCase(),
        );
        if (!found) {
          disagreements.push(
            `Gemini explanation omitted high-severity finding ${finding.ruleId}. Preserving finding deterministically.`,
          );
          validated.criticalFindings.push({
            ruleId: finding.ruleId,
            explanation: finding.explanation,
            evidenceReferenceIds: [],
          });
        }
      }
    }

    return {
      ...validated,
      isFallback: false,
      modelUsed: modelName,
      ...(disagreements.length > 0 ? { disagreementsWithSTRS: disagreements } : {}),
    };
  } catch (err: any) {
    // Record safe diagnostic message without exposing any secrets or API keys
    const detail = err?.cause?.message ? `${err.message} (${err.cause.message})` : (err?.message || "Unknown Gemini error");
    const safeErrorMsg = String(detail).replace(/AIza[0-9A-Za-z-_]{35}/g, "[REDACTED_KEY]");

    return createDeterministicFallback(input, safeErrorMsg);
  }
}

// ============================================================================
// Backward-compatibility adapters for existing components and tests
// ============================================================================

const EvidenceSchema = z.object({
  source: z.string().min(1, "Source must not be empty"),
  uri: z.string().url("URI must be a valid URL"),
  snippet: z.string(),
});

const FindingSchema = z.object({
  id: z.string(),
  description: z.string(),
  severity: z.number().min(0).max(10),
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string()),
});

const ExplanationSchema = z.object({
  summary: z.string(),
  findings: z.array(FindingSchema),
  evidence: z.array(EvidenceSchema),
  uncertainty: z.string(),
  limitations: z.string(),
});

export type Explanation = z.infer<typeof ExplanationSchema>;

function sanitizeSnippet(text: string): string {
  const lines = text.split(/\r?\n/);
  const filtered = lines.filter((l) => !/^\s*ignore\b/i.test(l));
  return filtered.join("\n").trim();
}

/**
 * Legacy synchronous adapter supporting existing PreSigningFlow and finalAudit tests.
 */
export function generateExplanation(
  breakdown: RuleResult[],
  retrieved: RetrievalResult[],
): Explanation {
  const evidence = retrieved.map((r) => {
    const safeSnippet = sanitizeSnippet(r.chunk.content);
    return {
      source: r.chunk.source,
      uri: r.chunk.uri,
      snippet: safeSnippet,
    };
  });

  const evidenceIdMap = new Map<string, string>();
  evidence.forEach((e) => {
    const id = `${e.source}:${e.uri}`;
    evidenceIdMap.set(id, id);
  });

  const findings = breakdown
    .filter((f) => f.severity > 0)
    .map((f) => {
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
    uncertainty: "The explanation is derived from deterministic risk rules and security corpus evidence.",
    limitations: "Unknown program IDs are treated as low-severity caution; evidence is limited to the indexed corpus.",
  };

  ExplanationSchema.parse(explanation);
  return explanation;
}

export default generateExplanation;
