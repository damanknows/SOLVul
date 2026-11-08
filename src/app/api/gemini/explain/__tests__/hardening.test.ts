/** @jest-environment node */
// src/app/api/gemini/explain/__tests__/hardening.test.ts

import crypto from "crypto";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { POST } from "../route";

// Mock @google/genai so tests have complete deterministic control over LLM behavior
const mockGenerateContent = jest.fn();
jest.mock("@google/genai", () => {
  return {
    GoogleGenAI: jest.fn().mockImplementation(() => ({
      models: {
        generateContent: (...args: any[]) => mockGenerateContent(...args),
      },
    })),
  };
});

describe("Phase 16.2: Backend Transaction Verification & Gemini API Hardening", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, GEMINI_API_KEY: "test-api-key" };

    // Default mock response: valid Gemini explanation
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        transactionSummary: "SystemProgram SOL transfer transaction.",
        riskExplanation: "STRS evaluated this transaction deterministically.",
        criticalFindings: [],
        affectedAssets: [],
        securityConcerns: [],
        recommendedActions: ["Verify recipient address before signing."],
        simulationInterpretation: "Simulation succeeded without runtime errors.",
        limitations: ["Static evaluation only."],
        evidenceReferences: [],
      }),
    });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  // Helper to generate a valid Solana transaction base64
  function createSampleTx(lamports = 10_000_000): { base64: string; rawBytes: Buffer; payer: Keypair } {
    const payer = Keypair.generate();
    const recipient = Keypair.generate();
    const tx = new Transaction();
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = "11111111111111111111111111111111";
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: recipient.publicKey,
        lamports,
      }),
    );
    const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    return {
      base64: Buffer.from(serialized).toString("base64"),
      rawBytes: Buffer.from(serialized),
      payer,
    };
  }

  // Helper to make POST request to route
  async function callExplainRoute(body: any, headers: Record<string, string> = {}) {
    const req = new Request("http://localhost:3000/api/gemini/explain", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
    const res = await POST(req);
    const json = await res.json().catch(() => null);
    return { status: res.status, json, headers: res.headers };
  }

  // --------------------------------------------------------------------------
  // 1. Malformed Base64 payload (returns 400)
  // --------------------------------------------------------------------------
  test("1. Rejects malformed Base64 payload with HTTP 400", async () => {
    const malformedInputs = [
      "not-valid-base64!@#$%",
      "abc", // length not divisible by 4
      "====", // invalid padding
      "A===", // invalid padding
      "????", // invalid chars
    ];

    for (const invalidBase64 of malformedInputs) {
      const { status, json } = await callExplainRoute({ base64Tx: invalidBase64 });
      expect(status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/Invalid or malformed Base64/i);
    }
  });

  // --------------------------------------------------------------------------
  // 2. Empty transaction payload (returns 400)
  // --------------------------------------------------------------------------
  test("2. Rejects empty transaction payload with HTTP 400", async () => {
    const emptyInputs = [
      "",
      "   ",
      Buffer.from([]).toString("base64"),
    ];

    for (const emptyInput of emptyInputs) {
      const { status, json } = await callExplainRoute({ base64Tx: emptyInput });
      expect(status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toMatch(/Empty transaction payload/i);
    }
  });

  // --------------------------------------------------------------------------
  // 3. Oversized payload (returns 413)
  // --------------------------------------------------------------------------
  test("3. Rejects oversized request payload with HTTP 413", async () => {
    // 3a. Content-Length header exceeding 1MB
    const headerResult = await callExplainRoute(
      { base64Tx: "AAAA" },
      { "Content-Length": "2000000" },
    );
    expect(headerResult.status).toBe(413);
    expect(headerResult.json.success).toBe(false);
    expect(headerResult.json.error).toMatch(/Payload too large/i);

    // 3b. Transaction raw wire bytes exceeding 64KB
    const oversizedBytes = Buffer.alloc(70 * 1024, 0x01); // 70 KB
    const oversizedBase64 = oversizedBytes.toString("base64");
    const wireResult = await callExplainRoute({ base64Tx: oversizedBase64 });
    expect(wireResult.status).toBe(413);
    expect(wireResult.json.success).toBe(false);
    expect(wireResult.json.error).toMatch(/exceeds maximum allowable size/i);
  });

  // --------------------------------------------------------------------------
  // 4. Incorrect client-supplied risk score (recomputed and overridden by authoritative STRS)
  // --------------------------------------------------------------------------
  test("4. Overrides incorrect client-supplied risk score with authoritative STRS computation", async () => {
    // Create a transaction that transfers 15 SOL (triggers VS-01: Large SOL transfer amount, score >= 20)
    const { base64: largeTxBase64 } = createSampleTx(15_000_000_000);

    // Adversarial client payload claims riskScore is 0 (LOW), attempting to disguise an attack
    const spoofedPayload = {
      base64Tx: largeTxBase64,
      inspection: {
        riskScore: 0,
        riskLevel: "LOW",
        confidence: 0.99,
        findings: [],
        instructions: [],
        simulation: { status: "success", limitations: [] },
        retrievedEvidence: [],
      },
    };

    const { status, json } = await callExplainRoute(spoofedPayload);
    expect(status).toBe(200);
    expect(json.success).toBe(true);

    // Authoritative score MUST NOT be the client-supplied 0 (VS-01 triggers score 19)
    expect(json.authoritativeScore).toBe(19);
    expect(json.isUnverifiedDemo).toBe(false);

    // Verify finding VS-01 was computed authoritatively
    const findingIds = json.findings.map((f: any) => f.ruleId || f.id);
    expect(findingIds).toContain("VS-01");
  });

  // --------------------------------------------------------------------------
  // 5. Client-supplied fake findings (recomputed and overridden by authoritative STRS)
  // --------------------------------------------------------------------------
  test("5. Discards client-supplied fake findings in favor of authoritative STRS findings", async () => {
    // Clean 0.01 SOL transfer
    const { base64: cleanTxBase64 } = createSampleTx(10_000_000);

    const clientPayloadWithFakeFindings = {
      base64Tx: cleanTxBase64,
      inspection: {
        riskScore: 90,
        riskLevel: "CRITICAL",
        confidence: 0.95,
        findings: [
          {
            ruleId: "FAKE-INJECTED-FINDING",
            severity: 10,
            confidence: 1.0,
            explanation: "Injected hallucination from client",
            affectedAccounts: [],
            evidence: {},
          },
        ],
        instructions: [],
        simulation: { status: "success", limitations: [] },
        retrievedEvidence: [],
      },
    };

    const { status, json } = await callExplainRoute(clientPayloadWithFakeFindings);
    expect(status).toBe(200);
    expect(json.success).toBe(true);

    // Clean transfer has score 0
    expect(json.authoritativeScore).toBe(0);
    expect(json.authoritativeRiskLevel).toBe("LOW");

    // "FAKE-INJECTED-FINDING" must NOT be in the authoritative findings
    const returnedRuleIds = json.findings.map((f: any) => f.ruleId || f.id);
    expect(returnedRuleIds).not.toContain("FAKE-INJECTED-FINDING");
  });

  // --------------------------------------------------------------------------
  // 6. SHA-256 correctness (identical wire bytes produce identical hashes, different produce different)
  // --------------------------------------------------------------------------
  test("6. Computes correct cryptographic SHA-256 transaction hash deterministically", async () => {
    const txA = createSampleTx(5_000_000);
    const txB = createSampleTx(99_000_000);

    // Expected hashes directly computed via crypto.createHash
    const expectedHashA = crypto.createHash("sha256").update(txA.rawBytes).digest("hex").toLowerCase();
    const expectedHashB = crypto.createHash("sha256").update(txB.rawBytes).digest("hex").toLowerCase();

    // Call 1 with Tx A
    const resA1 = await callExplainRoute({ base64Tx: txA.base64 });
    expect(resA1.status).toBe(200);
    expect(resA1.json.transactionHash).toBe(expectedHashA);

    // Call 2 with identical Tx A
    const resA2 = await callExplainRoute({ base64Tx: txA.base64 });
    expect(resA2.status).toBe(200);
    expect(resA2.json.transactionHash).toBe(expectedHashA);
    expect(resA1.json.transactionHash).toBe(resA2.json.transactionHash);

    // Call 3 with different Tx B
    const resB = await callExplainRoute({ base64Tx: txB.base64 });
    expect(resB.status).toBe(200);
    expect(resB.json.transactionHash).toBe(expectedHashB);
    expect(resB.json.transactionHash).not.toBe(resA1.json.transactionHash);

    // Verify hash format: 64 lowercase hex characters
    expect(resA1.json.transactionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // --------------------------------------------------------------------------
  // 7. Gemini timeout handling (returns deterministic fallback)
  // --------------------------------------------------------------------------
  test("7. Gracefully falls back to deterministic explanation on Gemini timeout without crashing", async () => {
    const { base64 } = createSampleTx(10_000_000);

    // Simulate Gemini API hanging / timing out
    mockGenerateContent.mockImplementation(
      () => new Promise((_, reject) => setTimeout(() => reject(new Error("Request timed out")), 50)),
    );

    const { status, json } = await callExplainRoute({ base64Tx: base64 });
    expect(status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.isFallback).toBe(true);
    expect(json.explanation.isFallback).toBe(true);

    // Deterministic fallback explanation fields are populated
    expect(json.explanation.transactionSummary).toBeTruthy();
    expect(json.explanation.riskExplanation).toContain("STRS evaluated this transaction");
    expect(json.authoritativeScore).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 8. Gemini invalid response (returns deterministic fallback)
  // --------------------------------------------------------------------------
  test("8. Safely activates deterministic fallback when Gemini returns invalid or schema-violating output", async () => {
    const { base64 } = createSampleTx(10_000_000);

    // Case 8a: Model attempts to inject unexpected keys (e.g. riskScore override)
    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify({
        transactionSummary: "Summary",
        riskExplanation: "Risk explanation",
        criticalFindings: [],
        affectedAssets: [],
        securityConcerns: [],
        recommendedActions: [],
        simulationInterpretation: "Simulation OK",
        limitations: [],
        evidenceReferences: [],
        // Injected unauthorized property (strictly rejected by Zod .strict())
        riskScore: 0,
        overrideSeverity: "SAFE",
      }),
    });

    const res8a = await callExplainRoute({ base64Tx: base64 });
    expect(res8a.status).toBe(200);
    expect(res8a.json.isFallback).toBe(true);

    // Case 8b: Malformed non-JSON output
    mockGenerateContent.mockResolvedValueOnce({
      text: "Not JSON at all, model hallucinated freeform text.",
    });

    const res8b = await callExplainRoute({ base64Tx: base64 });
    expect(res8b.status).toBe(200);
    expect(res8b.json.isFallback).toBe(true);
  });

  // --------------------------------------------------------------------------
  // 9. API key not exposed in error or response
  // --------------------------------------------------------------------------
  test("9. Redacts API keys from errors and ensures API keys are never exposed in responses", async () => {
    const { base64 } = createSampleTx(10_000_000);
    const mockApiKey = "AIzaSyB1234567890abcdefghijklmnopqrstuv";

    // Simulate an error from an upstream SDK that includes the raw API key in the message
    mockGenerateContent.mockRejectedValueOnce(
      new Error(`Authentication failed with key: ${mockApiKey}`),
    );

    const { status, json } = await callExplainRoute({ base64Tx: base64 });
    expect(status).toBe(200); // Handled by deterministic fallback

    const serializedResponse = JSON.stringify(json);
    expect(serializedResponse).not.toContain(mockApiKey);

    // If an unhandled top-level exception leaks an API key, verify the 500 handler redacts it
    const mockFailingReq = {
      headers: { get: () => null },
      text: async () => {
        throw new Error(`Critical upstream failure with credential ${mockApiKey}`);
      },
    } as unknown as Request;

    const errRes = await POST(mockFailingReq);
    expect(errRes.status).toBe(500);
    const errJson = await errRes.json();
    expect(errJson.success).toBe(false);
    expect(JSON.stringify(errJson)).not.toContain(mockApiKey);
    expect(errJson.error).toContain("[REDACTED_KEY]");
  });

  // --------------------------------------------------------------------------
  // 10. Safe API error response (no stack trace leaked)
  // --------------------------------------------------------------------------
  test("10. Suppresses internal stack traces and paths in error responses", async () => {
    // Malformed JSON body
    const req = new Request("http://localhost:3000/api/gemini/explain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "INVALID_JSON_BODY{{{",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();

    expect(json.success).toBe(false);
    expect(json.stack).toBeUndefined();
    expect(JSON.stringify(json)).not.toMatch(/node_modules/i);
    expect(JSON.stringify(json)).not.toMatch(/at Object\./i);
  });

  // --------------------------------------------------------------------------
  // 11. Unverified demo data isolation
  // --------------------------------------------------------------------------
  test("11. Explicitly isolates and flags unverified demo inspection input without base64Tx", async () => {
    const demoPayload = {
      inspection: {
        riskScore: 42,
        riskLevel: "MEDIUM",
        confidence: 0.8,
        findings: [
          {
            ruleId: "DEMO-01",
            severity: 5,
            confidence: 0.8,
            explanation: "Demo finding",
            affectedAccounts: [],
            evidence: {},
          },
        ],
        instructions: [],
        simulation: { status: "demo", limitations: ["Demo only"] },
        retrievedEvidence: [],
      },
    };

    const { status, json } = await callExplainRoute(demoPayload);
    expect(status).toBe(200);
    expect(json.isUnverifiedDemo).toBe(true);
    expect(json.isDemo).toBe(true);
    expect(json.authoritativeScore).toBeNull();
    expect(json.authoritativeRiskLevel).toBe("UNVERIFIED_DEMO");
    expect(json.transactionHash).toBe("unverified_demo_payload");
    expect(json.warning).toMatch(/UNVERIFIED DEMO DATA/);
  });
});
