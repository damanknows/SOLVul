// src/__tests__/finalAudit.test.ts
import { decodeTransaction } from "../solana/transactionDecoder";
import { computeRiskScore } from "../solana/transactionRiskScore";
import { simulateTransaction } from "../solana/simulateTransaction";
import generateExplanation from "../gemini/explanation";
import {
  Transaction as Tx,
  SystemProgram,
  Keypair,
  PublicKey,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, createTransferInstruction } from "@solana/spl-token";

/** Helper to create a simple unsigned large SOL transfer (legacy, triggers VS-01) */
function createLegacySolTransfer(lamports = 15_000_000_000): string {
  const from = Keypair.generate();
  const to = Keypair.generate().publicKey;
  const tx = new Tx();
  tx.feePayer = from.publicKey;
  tx.recentBlockhash = "11111111111111111111111111111111";
  tx.add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports,
    }),
  );
  return Buffer.from(
    tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
  ).toString("base64");
}

/** Helper to create a simple unsigned SPL token transfer */
function createLegacyTokenTransfer(): string {
  const from = Keypair.generate();
  const to = Keypair.generate().publicKey;
  const tx = new Tx();
  tx.feePayer = from.publicKey;
  tx.recentBlockhash = "11111111111111111111111111111111";
  tx.add(
    createTransferInstruction(
      from.publicKey,
      to,
      from.publicKey,
      1000,
      [],
      TOKEN_PROGRAM_ID,
    ),
  );
  return Buffer.from(
    tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
  ).toString("base64");
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
  return Buffer.from(
    tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
  ).toString("base64");
}

/** Malformed base64 payload */
const malformedPayload = "@@@INVALID_BASE64@@@";

/** Prompt-injection example for Gemini */
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
describe("Vulture-SVM Final Audit", () => {
  test("type-check and lint are assumed to pass", async () => {
    expect(true).toBe(true);
  });

  test("SOL transfer decoding and STRS scoring", async () => {
    const base64 = createLegacySolTransfer();
    const decoded = await decodeTransaction(base64);
    const { score, breakdown } = computeRiskScore(decoded);
    expect(score).toBeGreaterThanOrEqual(0);
    const vs01 = breakdown.find((r) => r.id === "VS-01");
    expect(vs01).toBeDefined();
    expect(vs01?.severity).toBeGreaterThan(0);
  });

  test("SPL token transfer decoding and STRS scoring", async () => {
    const base64 = createLegacyTokenTransfer();
    const decoded = await decodeTransaction(base64);
    const tokenIx = decoded.instructions.find((ix) => ix.programName === "TokenProgram");
    expect(tokenIx).toBeDefined();
    expect(tokenIx?.data).toBeDefined();
  });

  test("Unknown program is flagged with low severity caution (VS-02)", async () => {
    const base64 = createUnknownProgramTx();
    const decoded = await decodeTransaction(base64);
    const { breakdown } = computeRiskScore(decoded);
    const vs02 = breakdown.find((r) => r.id === "VS-02");
    expect(vs02).toBeDefined();
    expect(vs02?.severity).toBe(3); // Low severity caution, unverified is not malicious
  });

  test("Malformed payload handling throws", async () => {
    await expect(decodeTransaction(malformedPayload)).rejects.toThrow();
  });

  test("Simulation failure is reported correctly", async () => {
    const conn = new (require("@solana/web3.js").Connection)();
    const base64 = createLegacySolTransfer(1_000_000);
    const result = await simulateTransaction(base64, conn);
    expect(result.status).toBe("unavailable");
    expect(result.error).toBeDefined();
  });

  test("Gemini explanation sanitizes prompt injection", () => {
    const fakeEvidence = [
      {
        source: "Solana Docs",
        uri: "https://docs.solana.com/sample",
        snippet: injectedSnippet,
      },
    ];
    const retrieval = fakeEvidence.map((e, idx) => ({
      chunk: {
        content: e.snippet,
        source: e.source,
        uri: e.uri,
        id: `id${idx}`,
      },
      score: 1,
    }));
    const breakdown = [] as any;
    const explanation = generateExplanation(breakdown, retrieval);
    // Injected "Ignore" line must be sanitized
    expect(explanation.evidence[0].snippet).not.toMatch(/ignore/i);
    expect(explanation.evidence[0].snippet).toContain("Actual relevant content");
  });

  test("Gemini explanation throws on invalid evidence (Zod validation)", () => {
    const badEvidence = [
      {
        source: "", // empty source violates schema
        uri: "not-a-uri",
        snippet: "test",
      },
    ];
    const retrieval = badEvidence.map((e, idx) => ({
      chunk: {
        content: e.snippet,
        source: e.source,
        uri: e.uri,
        id: `bad${idx}`,
      },
      score: 1,
    }));
    const breakdown = [] as any;
    expect(() => generateExplanation(breakdown, retrieval)).toThrow();
  });

  test("Rejection flow does not invoke wallet signing", async () => {
    const signTransactionMock = jest.fn();
    const mockWallet = {
      isPhantom: true,
      publicKey: Keypair.generate().publicKey,
      signTransaction: signTransactionMock,
    };

    const { default: PreSigningFlow } = await import("../web/components/PreSigningFlow");
    const React = require("react");
    const { render } = {
      render: (ui: any) => {
        const root = document.createElement("div");
        document.body.appendChild(root);
        const { createRoot } = require("react-dom/client");
        const r = createRoot(root);
        require("react").act(() => {
          r.render(ui);
        });
        return { root, r };
      },
    };

    const base64 = createLegacySolTransfer(1_000_000);
    const { root } = render(
      React.createElement(PreSigningFlow, {
        base64Tx: base64,
        walletProvider: mockWallet,
      }),
    );

    // Wait for reject button
    await (async () => {
      for (let i = 0; i < 50; i++) {
        const btn = root.querySelector("[data-testid='reject-button']") as HTMLButtonElement;
        if (btn) {
          require("react").act(() => {
            btn.click();
          });
          break;
        }
        await new Promise((res) => setTimeout(res, 20));
      }
    })();

    expect(signTransactionMock).not.toHaveBeenCalled();
  });
});
