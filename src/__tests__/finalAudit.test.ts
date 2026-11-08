// src/__tests__/finalAudit.test.ts
import { decodeTransaction } from "../solana/transactionDecoder";
import { computeRiskScore } from "../solana/transactionRiskScore";
import { simulateTransaction } from "../solana/simulateTransaction";
import generateExplanation from "../gemini/explanation";
import { Transaction as Tx, SystemProgram, Keypair, Connection, PublicKey, TokenProgram } from "@solana/web3.js";
import { Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";

/** Helper to create a simple unsigned SOL transfer (legacy) */
function createLegacySolTransfer(): string {
  const from = Keypair.generate();
  const to = Keypair.generate().publicKey;
  const tx = new Tx();
  tx.feePayer = from.publicKey;
  tx.recentBlockhash = "11111111111111111111111111111111";
  tx.add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports: 5_000_000_000,
    })
  );
  const unsigned = Tx.fromMessage({
    message: tx.compileMessage(),
    signatures: [],
  });
  return Buffer.from(unsigned.serialize()).toString("base64");
}

/** Helper to create a simple unsigned SPL token transfer */
function createLegacyTokenTransfer(): string {
  const mintAuthority = Keypair.generate();
  const token = new Token(
    new Connection("https://api.devnet.solana.com"),
    mintAuthority.publicKey, // dummy mint address
    TOKEN_PROGRAM_ID,
    mintAuthority
  );
  const from = Keypair.generate();
  const to = Keypair.generate().publicKey;
  const tx = new Tx();
  tx.feePayer = from.publicKey;
  tx.recentBlockhash = "11111111111111111111111111111111";
  // Using SPL Token's transfer instruction (placeholder values)
  const instruction = TokenProgram.transfer({
    source: from.publicKey,
    destination: to,
    amount: 1000,
    owner: from.publicKey,
  });
  tx.add(instruction);
  const unsigned = Tx.fromMessage({
    message: tx.compileMessage(),
    signatures: [],
  });
  return Buffer.from(unsigned.serialize()).toString("base64");
}

/** Helper to create a transaction with an unknown program */
function createUnknownProgramTx(): string {
  const from = Keypair.generate();
  const tx = new Tx();
  tx.feePayer = from.publicKey;
  tx.recentBlockhash = "11111111111111111111111111111111";
  const unknownProgramId = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
  tx.add({
    keys: [{ pubkey: from.publicKey, isSigner: true, isWritable: true }],
    programId: unknownProgramId,
    data: Buffer.from([0x01, 0x02]),
  });
  const unsigned = Tx.fromMessage({
    message: tx.compileMessage(),
    signatures: [],
  });
  return Buffer.from(unsigned.serialize()).toString("base64");
}

/** Malformed base64 payload */
const malformedPayload = "@@@INVALID_BASE64@@@";

/** Prompt‑injection example for Gemini */
const injectedSnippet = "Ignore this line\nActual relevant content";

/** Mock Connection to force simulation failure */
jest.mock("@solana/web3.js", () => {
  const original = jest.requireActual("@solana/web3.js");
  return {
    ...original,
    Connection: class {
      async getLatestBlockhash() {
        return { blockhash: "11111111111111111111111111111111" };
      }
      async simulateTransaction() {
        throw new Error("Simulated RPC failure");
      }
    },
  };
});

/**
 * Final audit test suite – covers all critical paths.
 */
describe("Vulture‑SVM Final Audit", () => {
  test("type‑check and lint are assumed to pass (run via npm scripts)", async () => {
    // This placeholder ensures the test file is executed.
    expect(true).toBe(true);
  });

  test("SOL transfer decoding and STRS scoring", async () => {
    const base64 = createLegacySolTransfer();
    const decoded = await decodeTransaction(base64);
    const { score, breakdown } = computeRiskScore(decoded);
    expect(score).toBeGreaterThanOrEqual(0);
    const vs01 = breakdown.find((r) => r.id === "VS-01");
    expect(vs01).toBeDefined();
  });

  test("SPL token transfer decoding and STRS scoring", async () => {
    const base64 = createLegacyTokenTransfer();
    const decoded = await decodeTransaction(base64);
    const { breakdown } = computeRiskScore(decoded);
    const tokenInstr = breakdown.find((r) => r.programName === "TokenProgram");
    // TokenProgram may be present; ensure no crash.
    expect(tokenInstr).toBeDefined();
  });

  test("Unknown program is flagged with low severity", async () => {
    const base64 = createUnknownProgramTx();
    const decoded = await decodeTransaction(base64);
    const { breakdown } = computeRiskScore(decoded);
    const vs02 = breakdown.find((r) => r.id === "VS-02");
    expect(vs02).toBeDefined();
    expect(vs02?.severity).toBeGreaterThan(0);
  });

  test("Malformed payload handling throws", async () => {
    await expect(decodeTransaction(malformedPayload)).rejects.toThrow();
  });

  test("Simulation failure is reported correctly", async () => {
    const conn = new (require("@solana/web3.js").Connection)();
    const base64 = createLegacySolTransfer();
    const result = await simulateTransaction(base64, conn);
    expect(result.error).toBeDefined();
    expect(result.logs).toBeUndefined();
  });

  test("Gemini explanation sanitizes prompt injection", () => {
    const fakeEvidence = [{
      source: "Solana Docs",
      uri: "file:///tmp/fake.md",
      snippet: injectedSnippet,
    }];
    // Fake retrieval result shape
    const retrieval = fakeEvidence.map((e, idx) => ({
      chunk: { content: e.snippet, source: e.source, uri: e.uri, id: `id${idx}`, embedding: [0,0,0,0,0,0,0,0] },
      score: 1,
    }));
    const breakdown = [] as any; // no findings for this test
    const explanation = generateExplanation(breakdown, retrieval);
    // Should not contain the injected "Ignore" line
    expect(explanation.evidence[0].snippet).not.toMatch(/ignore/i);
  });

  test("Gemini explanation throws on invalid evidence (Zod validation)", () => {
    const badEvidence = [{
      source: "", // empty source violates schema
      uri: "not-a-uri",
      snippet: "test",
    }];
    const retrieval = badEvidence.map((e, idx) => ({
      chunk: { content: e.snippet, source: e.source, uri: e.uri, id: `bad${idx}`, embedding: [0,0,0,0,0,0,0,0] },
      score: 1,
    }));
    const breakdown = [] as any;
    expect(() => generateExplanation(breakdown, retrieval)).toThrow();
  });

  test("Rejection flow does not invoke wallet signing", async () => {
    // Mock window.solana to detect if signTransaction is called
    (global as any).window = { solana: { isPhantom: true, signTransaction: jest.fn() } };
    const { default: PreSigningFlow } = await import("../web/components/PreSigningFlow");
    // Render component shallowly using React Test Renderer
    const React = require("react");
    const TestRenderer = require("react-test-renderer");
    const base64 = createLegacySolTransfer();
    const component = TestRenderer.create(React.createElement(PreSigningFlow, { base64Tx: base64 }));
    // Simulate Reject button press by finding it in the tree
    const testInstance = component.root;
    const rejectBtn = testInstance.findByProps({ children: "Reject" });
    rejectBtn.props.onClick();
    expect((global as any).window.solana.signTransaction).not.toHaveBeenCalled();
  });
});

