// src/gemini/schemas.ts
import { z } from "zod";

/**
 * Zod schema for input findings.
 */
export const FindingInputSchema = z.object({
  ruleId: z.string().min(1),
  severity: z.union([z.string(), z.number()]),
  confidence: z.number().min(0).max(1),
  explanation: z.string().min(1),
  instructionIndex: z.number().optional(),
  affectedAccounts: z.array(z.string()).default([]),
  evidence: z.record(z.unknown()).default({}),
});

/**
 * Zod schema for decoded instructions.
 */
export const InstructionInputSchema = z.object({
  index: z.number(),
  programId: z.string().min(1),
  programName: z.string().optional(),
  instructionName: z.string().optional(),
  accounts: z.array(z.string()).default([]),
  decodedData: z.record(z.unknown()).optional(),
});

/**
 * Zod schema for simulation input.
 */
export const SimulationInputSchema = z.object({
  status: z.string().min(1),
  error: z.string().optional(),
  logs: z.array(z.string()).optional(),
  limitations: z.array(z.string()).default([]),
});

/**
 * Zod schema for retrieved evidence chunks.
 */
export const RetrievedEvidenceInputSchema = z.object({
  documentId: z.string().min(1),
  title: z.string().min(1),
  sourceUrl: z.string().optional(),
  excerpt: z.string().min(1),
  relevanceScore: z.number().optional(),
  findingId: z.string().optional(),
  trustLevel: z.string().optional(),
});

/**
 * Server-side validation schema for Gemini analysis input.
 */
export const GeminiAnalysisInputSchema = z.object({
  transactionId: z.string().optional(),
  transactionHash: z.string().optional(),
  network: z.string().optional().default("devnet"),

  riskScore: z.number().min(0).max(100),
  riskLevel: z.string().min(1),
  confidence: z.number().min(0).max(1),

  findings: z.array(FindingInputSchema).default([]),
  instructions: z.array(InstructionInputSchema).default([]),
  simulation: SimulationInputSchema,
  retrievedEvidence: z.array(RetrievedEvidenceInputSchema).default([]),
});

/**
 * Standard Base64 regex pattern (canonical 4-character blocks with optional padding).
 */
export const BASE64_REGEX = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Validates that a string is non-empty, well-formed Base64, and can be correctly decoded.
 */
export function isValidBase64(str: unknown): boolean {
  if (typeof str !== "string" || !str.trim()) return false;
  const trimmed = str.trim();
  if (trimmed.length % 4 !== 0) return false;
  if (!BASE64_REGEX.test(trimmed)) return false;
  try {
    const buf = Buffer.from(trimmed, "base64");
    if (buf.length === 0) return false;
    return buf.toString("base64") === trimmed;
  } catch {
    return false;
  }
}

/**
 * Strict Zod schema for validating Gemini model JSON output.
 * Rejects unexpected properties injected by adversarial models or prompts.
 */
export const CriticalFindingSchema = z.object({
  ruleId: z.string().min(1, "ruleId must not be empty"),
  explanation: z.string().min(1, "explanation must not be empty"),
  evidenceReferenceIds: z.array(z.string()).default([]),
}).strict();

export const EvidenceReferenceSchema = z.object({
  documentId: z.string().min(1, "documentId must not be empty"),
  reason: z.string().min(1, "reason must not be empty"),
}).strict();

export const GeminiExplanationSchema = z.object({
  transactionSummary: z.string().min(1, "transactionSummary must not be empty"),
  riskExplanation: z.string().min(1, "riskExplanation must not be empty"),
  criticalFindings: z.array(CriticalFindingSchema).default([]),
  affectedAssets: z.array(z.string()).default([]),
  securityConcerns: z.array(z.string()).default([]),
  recommendedActions: z.array(z.string()).default([]),
  simulationInterpretation: z.string().min(1, "simulationInterpretation must not be empty"),
  limitations: z.array(z.string()).default([]),
  evidenceReferences: z.array(EvidenceReferenceSchema).default([]),
}).strict();
