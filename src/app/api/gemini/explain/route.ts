// src/app/api/gemini/explain/route.ts
import { z } from "zod";
import { decodeTransaction } from "../../../../solana/transactionDecoder";
import { computeRiskScore } from "../../../../solana/transactionRiskScore";
import { retrieve } from "../../../../rag/retriever";
import { generateSecurityExplanation } from "../../../../gemini/explanation";
import { GeminiAnalysisInputSchema } from "../../../../gemini/schemas";
import type { GeminiAnalysisInput } from "../../../../gemini/types";

/** Maximum allowable request body size in bytes (1 MB) */
const MAX_REQUEST_SIZE_BYTES = 1024 * 1024;

/**
 * Incoming request schema.
 * Either `base64Tx` (preferred for authoritative server-side STRS)
 * or `inspection` (pre-computed inspection payload).
 */
const ExplainRequestSchema = z.object({
  base64Tx: z.string().optional(),
  inspection: GeminiAnalysisInputSchema.optional(),
  network: z.string().optional().default("devnet"),
}).refine((data) => data.base64Tx || data.inspection, {
  message: "Either 'base64Tx' or 'inspection' must be provided",
});

/**
 * Route handler for POST /api/gemini/explain
 *
 * Enforces:
 * 1. Payload size limits (<= 1MB).
 * 2. Zod validation of request body.
 * 3. Authoritative STRS computation on the server if `base64Tx` is supplied,
 *    preventing client manipulation of deterministic risk scores.
 * 4. Error isolation without leaking internal stack traces or API keys.
 */
export async function POST(req: Request): Promise<Response> {
  try {
    // 1. Enforce payload size limit
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

    const { base64Tx, inspection } = parseResult.data;
    let analysisInput: GeminiAnalysisInput;

    // 2. Authoritative STRS Evaluation
    if (base64Tx && base64Tx.trim()) {
      // Decode and compute STRS authoritatively on the server
      const decoded = await decodeTransaction(base64Tx);
      const assessment = computeRiskScore(decoded);

      // Retrieve evidence from security corpus
      const retrieved = await retrieve("security", (globalThis as any).vectorStore, 4);

      analysisInput = {
        transactionHash: base64Tx.slice(0, 32),
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
        simulation: {
          status: "not_simulated",
          limitations: [
            "Simulation not requested in explanation endpoint; evaluation based on static bytecode and schema analysis.",
          ],
        },
        retrievedEvidence: retrieved.map((r) => ({
          documentId: r.chunk.id,
          title: r.chunk.source,
          sourceUrl: r.chunk.uri,
          excerpt: r.chunk.content,
        })),
      };
    } else if (inspection) {
      analysisInput = inspection;
    } else {
      return new Response(
        JSON.stringify({ success: false, error: "Missing inspection input" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // 3. Generate Gemini Explanation (with automatic fallback on any error)
    const explanation = await generateSecurityExplanation(analysisInput);

    return new Response(
      JSON.stringify({
        success: true,
        explanation,
        isFallback: explanation.isFallback,
        authoritativeScore: analysisInput.riskScore,
        authoritativeRiskLevel: analysisInput.riskLevel,
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
