// src/lib/audit/__tests__/auditReceipt.test.ts
import {
  generateAuditReceipt,
  verifyAuditReceipt,
  formatAuditReceiptMarkdown,
  downloadAuditReceipt,
  SecurityAuditReceipt,
} from "../auditReceipt";
import type { DecodedTransaction } from "../../../solana/transactionDecoder";
import type { TransactionRiskAssessment } from "../../../solana/transactionRiskScore";

describe("Security Audit Receipt Generator & Exporter", () => {
  const dummyHash = "142728538d5fecb49909ad32d3160c3cbd796335a6ccfa2b1d0f5c84646061a9";
  const dummyBase64 = "AQABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB";

  const dummyDecoded: DecodedTransaction = {
    version: "v0",
    signatures: [],
    message: {
      accountKeys: ["Account1111111111111111111111111111111111111"],
      recentBlockhash: "11111111111111111111111111111111",
      instructionCount: 1,
      header: {
        numRequiredSignatures: 1,
        numReadonlySignedAccounts: 0,
        numReadonlyUnsignedAccounts: 0,
      },
    },
    instructions: [
      {
        programId: "11111111111111111111111111111111",
        programName: "SystemProgram",
        isUnsupported: false,
        accounts: [],
        data: "Transfer",
      },
    ],
  };

  const dummyRisk: TransactionRiskAssessment = {
    score: 85,
    riskLevel: "CRITICAL",
    confidence: 0.9,
    dimensions: {
      amount: { score: 0, weight: 0.25 },
      program: { score: 80, weight: 0.2 },
      authority: { score: 0, weight: 0.25 },
      simulation: { score: 0, weight: 0.15 },
      complexity: { score: 0, weight: 0.1 },
      instructionCount: { score: 0, weight: 0.05 },
    },
    allRulesEvaluated: [],
    limitations: [],
    scoringVersion: "1.0.0",
    breakdown: [
      {
        id: "VS-02",
        description: "Unknown program invocation",
        severity: 8,
        confidence: 0.9,
        explanation: "Unverified custom program invoked.",
        evidence: { programId: "Unknown11111111111" },
        affectedAccounts: ["Unknown11111111111"],
        dimension: "program",
      },
    ],
  };

  const dummyExplanation = {
    summary: "Critical risk detected due to unverified program interaction.",
    risks: ["Funds could be drained by unverified program."],
    recommendations: ["Do not sign without verifying bytecode."],
    findings: [
      {
        id: "VS-02",
        severity: 8,
        confidence: 0.9,
        description: "Unknown program invocation",
        evidenceIds: ["ev-1"],
      },
    ],
    evidence: [
      {
        source: "Solana Security Guide",
        uri: "https://solana.com/docs",
        snippet: "Programs not on allowlists must be treated as untrusted.",
      },
    ],
    uncertainty: "Low",
    limitations: "None",
  };

  test("1. Generates verifiable structured audit receipt object", () => {
    const receipt = generateAuditReceipt({
      base64Tx: dummyBase64,
      sha256Hash: dummyHash,
      decodedTx: dummyDecoded,
      riskAssessment: dummyRisk,
      explanation: dummyExplanation,
      isTampered: false,
    });

    expect(receipt.version).toBe("1.0.0");
    expect(receipt.payload.sha256).toBe(dummyHash);
    expect(receipt.payload.version).toBe("v0");
    expect(receipt.payload.header?.numRequiredSignatures).toBe(1);
    expect(receipt.strsRiskScore.score).toBe(85);
    expect(receipt.strsRiskScore.riskLevel).toBe("CRITICAL");
    expect(receipt.strsRiskScore.triggeredRules).toHaveLength(1);
    expect(receipt.strsRiskScore.triggeredRules[0].id).toBe("VS-02");
    expect(receipt.ragCitations).toHaveLength(1);
    expect(receipt.ragCitations[0].source).toBe("Solana Security Guide");
    expect(receipt.cryptographicBinding.status).toBe("VERIFIED");
  });

  test("2. Flags TAMPERED when isTampered is true", () => {
    const receipt = generateAuditReceipt({
      base64Tx: dummyBase64,
      sha256Hash: dummyHash,
      decodedTx: dummyDecoded,
      isTampered: true,
    });

    expect(receipt.cryptographicBinding.status).toBe("TAMPERED");
  });

  test("3. Formats audit receipt into valid GitHub Markdown with alert blocks and tables", () => {
    const receipt = generateAuditReceipt({
      base64Tx: dummyBase64,
      sha256Hash: dummyHash,
      decodedTx: dummyDecoded,
      riskAssessment: dummyRisk,
      explanation: dummyExplanation,
      isTampered: false,
    });

    const md = formatAuditReceiptMarkdown(receipt);
    expect(md).toContain("# 🛡️ SOLVul Verifiable Transaction Security Audit Receipt");
    expect(md).toContain(`\`${dummyHash}\``);
    expect(md).toContain("STRS Risk Score");
    expect(md).toContain("VS-02");
    expect(md).toContain("Solana Security Guide");
    expect(md).toContain("Pre-Sign Security Attestation");
  });

  test("4. Formats tampering warning in markdown when tampering is detected", () => {
    const receipt = generateAuditReceipt({
      base64Tx: dummyBase64,
      sha256Hash: dummyHash,
      isTampered: true,
    });

    const md = formatAuditReceiptMarkdown(receipt);
    expect(md).toContain("CRITICAL SECURITY ALERT: PAYLOAD TAMPERING DETECTED");
  });

  test("5. downloadAuditReceipt creates blob and triggers download in browser DOM", () => {
    const receipt = generateAuditReceipt({
      base64Tx: dummyBase64,
      sha256Hash: dummyHash,
      decodedTx: dummyDecoded,
    });

    // Mock document.createElement and URL APIs
    const clickMock = jest.fn();
    const originalCreateElement = document.createElement.bind(document);

    jest.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const el = originalCreateElement(tagName);
      if (tagName === "a") {
        el.click = clickMock;
      }
      return el;
    });

    window.URL.createObjectURL = jest.fn().mockReturnValue("blob:mock-url");
    window.URL.revokeObjectURL = jest.fn();

    // Trigger JSON download
    downloadAuditReceipt(receipt, "json");
    expect(clickMock).toHaveBeenCalledTimes(1);

    // Trigger Markdown download
    downloadAuditReceipt(receipt, "md");
    expect(clickMock).toHaveBeenCalledTimes(2);

    jest.restoreAllMocks();
  });

  describe("verifyAuditReceipt Integrity Attestation", () => {
    test("10. Audit receipt with missing verification yields UNVERIFIED", () => {
      // Incomplete receipt missing sha256 or base64Payload
      const incompleteReceipt = {
        version: "1.0.0",
        generator: "SOLVul Pre-Sign Firewall & Audit Engine",
        timestamp: new Date().toISOString(),
        payload: {
          sha256: "",
          version: "legacy",
          wireBytesLength: 0,
          base64Payload: "",
          recentBlockhash: "11111111111111111111111111111111",
          accountKeys: [],
          instructionCount: 0,
        },
        strsRiskScore: { score: 0, riskLevel: "SAFE", dimensionBreakdown: {} as any, triggeredRules: [] },
        ragCitations: [],
        geminiExplanation: { summary: "None", risks: [], recommendations: [], findings: [] },
        cryptographicBinding: {
          algorithm: "SHA-256",
          toctouProtection: "Bit-for-bit pre-sign serialization equality verified",
          inspectedHash: "",
          status: "UNVERIFIED" as any,
        },
      } as SecurityAuditReceipt;

      const result = verifyAuditReceipt(incompleteReceipt);
      expect(result.status).toBe("UNVERIFIED");
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("Missing required cryptographic verification data");
    });

    test("11. Audit receipt with valid integrity check yields VERIFIED", () => {
      const receipt = generateAuditReceipt({
        base64Tx: dummyBase64,
        sha256Hash: dummyHash,
        decodedTx: dummyDecoded,
        riskAssessment: dummyRisk,
        explanation: dummyExplanation,
      });

      const result = verifyAuditReceipt(receipt);
      expect(result.status).toBe("VERIFIED");
      expect(result.isValid).toBe(true);
      expect(result.computedHash).toBe(dummyHash);
    });

    test("12. Audit receipt with modified contents yields TAMPERED", () => {
      const receipt = generateAuditReceipt({
        base64Tx: dummyBase64,
        sha256Hash: dummyHash,
        decodedTx: dummyDecoded,
        riskAssessment: dummyRisk,
        explanation: dummyExplanation,
      });

      // Tamper with payload by mutating a byte in base64Payload
      const tamperedBytes = Buffer.from(receipt.payload.base64Payload, "base64");
      tamperedBytes[0] = (tamperedBytes[0] + 1) % 256;
      receipt.payload.base64Payload = tamperedBytes.toString("base64");

      const result = verifyAuditReceipt(receipt);
      expect(result.status).toBe("TAMPERED");
      expect(result.isValid).toBe(false);
      expect(result.reason).toContain("Cryptographic");
    });
  });
});
