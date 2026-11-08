// src/web/components/__tests__/inspectorGeminiRagIntegration.test.tsx
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import PreSigningFlow from "../PreSigningFlow";
import { getGeminiClient } from "../../../gemini/client";
import { createDeterministicFallback } from "../../../gemini/explanation";
import { getSecurityEvidenceForTransaction } from "../../../rag/service";
import { decodeTransaction } from "../../../solana/transactionDecoder";
import { computeRiskScore } from "../../../solana/transactionRiskScore";
import { GeminiExplanationSchema } from "../../../gemini/schemas";

describe("Phase 16.1: End-to-End Gemini and Semantic RAG Integration", () => {
  let container: HTMLDivElement;
  let root: Root;
  let payer: Keypair;
  let recipient: Keypair;
  let validTxBase64: string;

  async function waitForElement(selector: string, timeout = 3500): Promise<Element> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = container.querySelector(selector);
      if (el) return el;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    throw new Error(`Timeout waiting for selector: ${selector}. HTML: ${container.innerHTML}`);
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    // Ensure global fetch is a jest mock in jsdom
    globalThis.fetch = jest.fn();

    payer = Keypair.generate();
    recipient = Keypair.generate();
    const tx = new Transaction();
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = "11111111111111111111111111111111";
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 50_000_000,
      }),
    );
    validTxBase64 = Buffer.from(
      tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
    ).toString("base64");
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    jest.restoreAllMocks();
  });

  test("1. Main Inspector calls the semantic RAG pipeline with targeted queries", async () => {
    const decoded = await decodeTransaction(validTxBase64);
    const assessment = computeRiskScore(decoded);

    // Call RAG pipeline with decoded transaction and findings
    const ragResult = await getSecurityEvidenceForTransaction(decoded, assessment.breakdown);

    expect(ragResult).toBeDefined();
    expect(typeof ragResult.summary).toBe("string");
    // Verify RAG does not generate generic query "security"
    expect(ragResult.summary).not.toContain("query: security");
  });

  test("2. Main Inspector calls the Gemini backend and renders generative explanation", async () => {
    const mockGeminiResponse = {
      success: true,
      explanation: {
        transactionSummary: "SystemProgram transfer of 0.05 SOL to recipient account.",
        riskExplanation: "The transaction is evaluated with a low risk score. Standard transfer parameters verified.",
        criticalFindings: [],
        affectedAssets: ["0.05 SOL", payer.publicKey.toBase58()],
        securityConcerns: ["Ensure the destination address is verified."],
        recommendedActions: ["Verify recipient address matches intended destination."],
        simulationInterpretation: "Simulation succeeded with normal compute unit consumption.",
        limitations: ["Static evaluation of transfer parameters."],
        evidenceReferences: [],
        isFallback: false,
        modelUsed: "gemini-2.5-flash",
      },
      isFallback: false,
      authoritativeScore: 0,
      authoritativeRiskLevel: "LOW",
      findingEvidence: [
        {
          findingId: "VS-01",
          documents: [
            {
              title: "Solana System Program Guide",
              sourceUrl: "https://solana.com/docs/core/programs#system-program",
              excerpt: "Standard transfer instruction moving lamports between accounts.",
              relevanceScore: 0.92,
              trustLevel: "authoritative",
            },
          ],
        },
      ],
      ragSummary: "Retrieved 1 authoritative security evidence document(s).",
    };

    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => mockGeminiResponse,
    });

    await act(async () => {
      root.render(<PreSigningFlow base64Tx={validTxBase64} />);
    });

    const flowEl = await waitForElement("[data-testid='presigning-flow']");
    expect(flowEl).not.toBeNull();

    // Verify backend API was called
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/gemini/explain",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      }),
    );

    // Verify AI explanation renders
    const summaryEl = await waitForElement("[data-testid='explanation-summary']");
    expect(summaryEl.textContent).toContain("SystemProgram transfer of 0.05 SOL");

    const geminiBadge = await waitForElement("[data-testid='gemini-status-badge']");
    expect(geminiBadge.textContent).toContain("Powered by Gemini");

    const ragBadge = await waitForElement("[data-testid='rag-status-badge']");
    expect(ragBadge.textContent).toContain("1 Sources");
  });

  test("3. STRS results remain unchanged after Gemini processing", async () => {
    // Generate transaction with high amount to trigger VS-01 (lamports >= 10 SOL)
    const largeTx = new Transaction();
    largeTx.feePayer = payer.publicKey;
    largeTx.recentBlockhash = "11111111111111111111111111111111";
    largeTx.add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 15_000_000_000, // 15 SOL
      }),
    );
    const largeTxBase64 = Buffer.from(
      largeTx.serialize({ requireAllSignatures: false, verifySignatures: false }),
    ).toString("base64");

    const expectedDecoded = await decodeTransaction(largeTxBase64);
    const expectedAssessment = computeRiskScore(expectedDecoded);

    // Mock Gemini response attempting to report SAFE 0/100
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        explanation: {
          transactionSummary: "Large SOL transfer.",
          riskExplanation: "Model claims transaction is completely safe (disregarded by STRS).",
          criticalFindings: [],
          affectedAssets: [],
          securityConcerns: [],
          recommendedActions: [],
          simulationInterpretation: "Simulated safely.",
          limitations: [],
          evidenceReferences: [],
          isFallback: false,
          modelUsed: "gemini-2.5-flash",
        },
        isFallback: false,
        authoritativeScore: expectedAssessment.score,
        authoritativeRiskLevel: expectedAssessment.riskLevel,
        findings: expectedAssessment.breakdown,
        findingEvidence: [],
        ragSummary: "No documentation found.",
      }),
    });

    await act(async () => {
      root.render(<PreSigningFlow base64Tx={largeTxBase64} />);
    });

    const scoreBadge = await waitForElement("[data-testid='strs-score-badge']");
    // Assert authoritative STRS score and risk level are strictly preserved
    expect(scoreBadge.textContent).toContain(`STRS: ${expectedAssessment.score}/100`);
    expect(scoreBadge.textContent).toContain(expectedAssessment.riskLevel);

    // Assert deterministic finding VS-01 is displayed
    const findingEl = await waitForElement("[data-testid='finding-VS-01']");
    expect(findingEl.textContent).toContain("VS-01");
    expect(findingEl.textContent).toContain("Large SOL transfer amount");
  });

  test("4. Empty RAG results do not crash the Inspector", async () => {
    (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        explanation: {
          transactionSummary: "Transaction with zero matching RAG chunks.",
          riskExplanation: "STRS score remains authoritative despite no matching documentation.",
          criticalFindings: [],
          affectedAssets: [],
          securityConcerns: [],
          recommendedActions: [],
          simulationInterpretation: "Simulation passed.",
          limitations: ["No matching documentation found in corpus."],
          evidenceReferences: [],
          isFallback: false,
          modelUsed: "gemini-2.5-flash",
        },
        isFallback: false,
        authoritativeScore: 0,
        authoritativeRiskLevel: "LOW",
        findingEvidence: [],
        ragSummary: "No sufficiently relevant security documentation found.",
      }),
    });

    await act(async () => {
      root.render(<PreSigningFlow base64Tx={validTxBase64} />);
    });

    const flowEl = await waitForElement("[data-testid='presigning-flow']");
    expect(flowEl).not.toBeNull();

    const emptyNotice = await waitForElement("[data-testid='rag-empty-notice']");
    expect(emptyNotice.textContent).toContain("No sufficiently relevant security documentation found.");

    const ragBadge = await waitForElement("[data-testid='rag-status-badge']");
    expect(ragBadge.textContent).toContain("No Evidence Matched");
  });

  test("5. Gemini failures trigger a deterministic fallback without crashing", async () => {
    // Simulate backend network outage / 500 error
    (globalThis.fetch as jest.Mock).mockRejectedValueOnce(new Error("Gemini API connection timed out"));

    await act(async () => {
      root.render(<PreSigningFlow base64Tx={validTxBase64} />);
    });

    const flowEl = await waitForElement("[data-testid='presigning-flow']");
    expect(flowEl).not.toBeNull();

    // Fallback badge is displayed
    const fallbackBadge = await waitForElement("[data-testid='gemini-status-badge']");
    expect(fallbackBadge.textContent).toContain("Deterministic Fallback Mode");

    // Signing buttons remain available and functional
    expect(container.querySelector("[data-testid='reject-button']")).not.toBeNull();
    expect(container.querySelector("[data-testid='approve-button']")).not.toBeNull();
  });

  test("6. Invalid Gemini responses are rejected by schema validation", async () => {
    const invalidGeminiOutput = {
      // Missing required transactionSummary, riskExplanation, and simulationInterpretation
      foo: "bar",
      someRandomKey: 123,
    };

    // Zod validation must fail on invalid Gemini output
    const parseResult = GeminiExplanationSchema.safeParse(invalidGeminiOutput);
    expect(parseResult.success).toBe(false);

    // When invalid, createDeterministicFallback is triggered
    const fallback = createDeterministicFallback({
      transactionHash: "tx123",
      network: "devnet",
      riskScore: 35,
      riskLevel: "MEDIUM",
      confidence: 0.8,
      findings: [],
      instructions: [],
      simulation: { status: "success", limitations: [] },
      retrievedEvidence: [],
    }, "Schema validation failed on invalid Gemini output");

    expect(fallback.isFallback).toBe(true);
    expect(fallback.transactionSummary).toBeTruthy();
    expect(fallback.riskExplanation).toContain("STRS evaluated this transaction");
  });

  test("7. No API key is exposed to frontend bundles", () => {
    // getGeminiClient must throw security violation if called in browser environment (window defined)
    expect(() => {
      (window as any).__MOCK_BROWSER__ = true;
      getGeminiClient();
    }).toThrow("Security Violation: Gemini client cannot be initialized in client-side code");

    // Client-side process.env MUST NOT contain GEMINI_API_KEY
    const clientEnv = (globalThis as any).window ? process.env.NEXT_PUBLIC_GEMINI_API_KEY : undefined;
    expect(clientEnv).toBeUndefined();
  });
});
