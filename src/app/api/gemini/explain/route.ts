// src/app/api/gemini/explain/route.ts
import crypto from "crypto";
import { z } from "zod";
import { decodeTransaction } from "../../../../solana/transactionDecoder";
import { computeRiskScore } from "../../../../solana/transactionRiskScore";
import { getSecurityEvidenceForTransaction, getRAGStatus } from "../../../../rag/service";
import { generateSecurityExplanation, createDeterministicFallback } from "../../../../gemini/explanation";
import { GeminiAnalysisInputSchema, isValidBase64 } from "../../../../gemini/schemas";
import { getGeminiModel } from "../../../../gemini/client";
import type { GeminiAnalysisInput } from "../../../../gemini/types";

/** Maximum allowable request body size in bytes (1 MB) */
const MAX_REQUEST_SIZE_BYTES = 1024 * 1024;

/** Maximum allowable decoded transaction wire bytes (64 KB) */
const MAX_TX_WIRE_BYTES = 64 * 1024;

/**
 * Incoming request schema.
 * Either `base64Tx` (authoritative transaction wire payload)
 * or `inspection` (unverified client-supplied demo payload).
 */
const ExplainRequestSchema = z.object({
  base64Tx: z.string().optional(),
  inspection: GeminiAnalysisInputSchema.optional(),
  simulation: z.object({
    status: z.string().min(1),
    error: z.string().optional(),
    logs: z.array(z.string()).optional(),
    limitations: z.array(z.string()).default([]),
  }).optional(),
  network: z.string().optional().default("devnet"),
  simulateOutage: z.boolean().optional().default(false),
  deterministicOnly: z.boolean().optional().default(false),
}).refine((data) => data.base64Tx !== undefined || data.inspection !== undefined, {
  message: "Either 'base64Tx' or 'inspection' must be provided",
});

/**
 * Route handler for POST /api/gemini/explain
 *
 * Enforces:
 * 1. Payload size limits (<= 1MB request body, <= 64KB transaction wire bytes).
 * 2. Strict Base64 validation and cryptographic SHA-256 wire hash calculation.
 * 3. Authoritative STRS computation on the server if `base64Tx` is supplied,
 *    preventing client manipulation of deterministic risk scores or findings.
 * 4. Explicit marking of unverified demo payloads if `base64Tx` is absent.
 * 5. Error isolation without leaking internal stack traces or API keys.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    // 1. Enforce payload size limit (HTTP header and raw body check)
    const contentLength = req.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > MAX_REQUEST_SIZE_BYTES) {
      return new Response(
        JSON.stringify({ success: false, error: "Payload too large (maximum 1MB allowed)" }),
        { status: 413, headers: { "Content-Type": "application/json" } },
      );
    }

    const rawBody = await req.text();
    if (rawBody.length > MAX_REQUEST_SIZE_BYTES) {
      return new Response(
        JSON.stringify({ success: false, error: "Payload too large (maximum 1MB allowed)" }),
        { status: 413, headers: { "Content-Type": "application/json" } },
      );
    }

    let jsonBody: unknown;
    try {
      jsonBody = JSON.parse(rawBody);
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Invalid JSON body" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const parseResult = ExplainRequestSchema.safeParse(jsonBody);
    if (!parseResult.success) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid request payload",
          details: parseResult.error.format(),
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const { base64Tx, inspection, simulation: simParam } = parseResult.data;
    let analysisInput: GeminiAnalysisInput;
    let ragResult: any = null;
    let transactionHash: string;
    let isUnverifiedDemo = false;
    let authoritativeScore: number | null = null;
    let authoritativeRiskLevel: string = "LOW";
    let authoritativeFindings: any[] = [];

    // 2. Authoritative STRS Evaluation via Serialized Transaction
    if (base64Tx !== undefined) {
      if (typeof base64Tx !== "string" || !base64Tx.trim()) {
        return new Response(
          JSON.stringify({ success: false, error: "Empty transaction payload" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      if (!isValidBase64(base64Tx)) {
        return new Response(
          JSON.stringify({ success: false, error: "Invalid or malformed Base64 transaction payload" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const rawBytes = Buffer.from(base64Tx.trim(), "base64");
      if (rawBytes.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: "Empty transaction payload" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      if (rawBytes.length > MAX_TX_WIRE_BYTES) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Transaction payload exceeds maximum allowable size (${MAX_TX_WIRE_BYTES / 1024}KB)`,
          }),
          { status: 413, headers: { "Content-Type": "application/json" } },
        );
      }

      // Compute cryptographic SHA-256 hash over exact raw wire bytes
      transactionHash = crypto.createHash("sha256").update(rawBytes).digest("hex").toLowerCase();

      // Decode and compute STRS authoritatively on the server
      let decoded;
      try {
        decoded = await decodeTransaction(base64Tx.trim());
      } catch {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Invalid transaction payload: unable to deserialize Solana transaction",
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const assessment = computeRiskScore(decoded);
      authoritativeScore = assessment.score;
      authoritativeRiskLevel = assessment.riskLevel;
      authoritativeFindings = assessment.breakdown;

      // Retrieve evidence-backed security documentation tailored specifically to findings & simulation
      try {
        ragResult = await getSecurityEvidenceForTransaction(decoded, assessment.breakdown, simParam);
      } catch {
        ragResult = {
          allRetrieved: [],
          evidence: [],
          summary: "No sufficiently relevant security documentation found.",
          hasResults: false,
        };
      }

      analysisInput = {
        transactionHash,
        network: parseResult.data.network,
        riskScore: assessment.score,
        riskLevel: assessment.riskLevel,
        confidence: assessment.confidence,
        findings: assessment.breakdown.map((f) => ({
          ruleId: f.id,
          severity: f.severity,
          confidence: f.confidence,
          explanation: f.explanation,
          instructionIndex: f.instructionIndex,
          affectedAccounts: f.affectedAccounts,
          evidence: f.evidence,
        })),
        instructions: decoded.instructions.map((ix, idx) => ({
          index: idx,
          programId: ix.programId,
          programName: ix.programName,
          instructionName: (ix.data as any)?.type,
          accounts: ix.accounts.map((a) => a.pubkey),
          decodedData: typeof ix.data === "object" ? (ix.data as any) : undefined,
        })),
        simulation: simParam ? {
          status: simParam.status,
          error: simParam.error,
          logs: simParam.logs,
          limitations: simParam.limitations,
        } : {
          status: "not_simulated",
          limitations: [
            "Simulation not requested in explanation endpoint; evaluation based on static bytecode and schema analysis.",
          ],
        },
        retrievedEvidence: ragResult.allRetrieved.map((r: any) => ({
          documentId: r.chunk.id,
          title: r.chunk.title,
          sourceUrl: r.chunk.sourceUrl,
          excerpt: r.chunk.content,
          relevanceScore: r.relevanceScore,
          findingId: r.findingId,
          trustLevel: r.chunk.trustLevel,
        })),
      };
    } else if (inspection) {
      // Demo inspection input without authoritative transaction bytes: explicitly mark unverified
      isUnverifiedDemo = true;
      transactionHash = "unverified_demo_payload";
      authoritativeScore = null;
      authoritativeRiskLevel = "UNVERIFIED_DEMO";
      authoritativeFindings = inspection.findings;

      analysisInput = {
        ...inspection,
        transactionHash,
        simulation: {
          status: inspection.simulation?.status || "demo",
          error: inspection.simulation?.error,
          logs: inspection.simulation?.logs,
          limitations: [
            "UNVERIFIED DEMO DATA: Transaction payload was not cryptographically verified or decoded on-chain; inspection data is untrusted client-supplied input.",
            ...(inspection.simulation?.limitations || []),
          ],
        },
      };
    } else {
      return new Response(
        JSON.stringify({ success: false, error: "Missing inspection input" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // 3. Generate Gemini Explanation (with automatic fallback on any error, or forced deterministic mode if simulated)
    const isOutageSimulated = Boolean(parseResult.data.simulateOutage || parseResult.data.deterministicOnly);
    const explanation = isOutageSimulated
      ? createDeterministicFallback(
          analysisInput,
          "Simulated Gemini outage: deterministic-only mode activated by judge toggle.",
        )
      : await generateSecurityExplanation(analysisInput);

    return new Response(
      JSON.stringify({
        success: true,
        transactionHash,
        isUnverifiedDemo,
        isDemo: isUnverifiedDemo,
        authoritativeScore,
        authoritativeRiskLevel,
        findings: authoritativeFindings,
        explanation,
        isFallback: explanation.isFallback,
        findingEvidence: (ragResult as any)?.evidence || [],
        ragSummary: (ragResult as any)?.summary || (analysisInput.retrievedEvidence.length > 0 ? "Evidence retrieved" : "No sufficiently relevant security documentation found."),
        ragStatus: {
          hasResults: Boolean((ragResult as any)?.hasResults),
          count: (ragResult as any)?.allRetrieved?.length || 0,
          operational: getRAGStatus(),
        },
        geminiStatus: {
          available: !explanation.isFallback,
          model: explanation.modelUsed || getGeminiModel(),
          isFallback: Boolean(explanation.isFallback),
        },
        ...(isUnverifiedDemo ? {
          warning: "UNVERIFIED DEMO DATA: Transaction was not verified on-chain. Client-supplied risk scores and findings are unverified.",
        } : {}),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    const safeError = err?.message
      ? String(err.message).replace(/AIza[0-9A-Za-z-_]{35}/g, "[REDACTED_KEY]")
      : "Internal server error occurred";

    return new Response(
      JSON.stringify({ success: false, error: safeError }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
