// src/solana/transactionRiskScore.test.ts
import { computeRiskScore, DEFAULT_RISK_CONFIG } from "./transactionRiskScore";
import { decodeTransaction } from "./transactionDecoder";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";

/** Helper to generate an unsigned legacy transfer transaction and return its decoded form. */
function getDecodedLegacyTransfer(): ReturnType<typeof decodeTransaction> {
  const from = Keypair.generate();
  const to = Keypair.generate().publicKey;
  const tx = new Transaction();
  tx.feePayer = from.publicKey;
  tx.recentBlockhash = "11111111111111111111111111111111";
  tx.add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports: 20_000_000_000, // 20 SOL – above default threshold
    })
  );
  // Do not sign – keep unsigned
  const unsignedTx = Transaction.fromMessage({
    message: tx.compileMessage(),
    signatures: [],
  });
  const base64 = Buffer.from(unsignedTx.serialize()).toString("base64");
  // decode synchronously (no connection needed for legacy)
  // @ts-ignore – decodeTransaction returns a Promise
  // we use async/await below
  return decodeTransaction(base64);
}

describe("Transaction Risk Score (STRS)", () => {
  test("high amount transfer yields elevated score", async () => {
    const decoded = await getDecodedLegacyTransfer();
    const { score, breakdown } = computeRiskScore(decoded, DEFAULT_RISK_CONFIG);
    // VS-01 should have severity 9
    const vs01 = breakdown.find((r) => r.id === "VS-01");
    expect(vs01).toBeDefined();
    if (vs01) {
      expect(vs01.severity).toBe(9);
    }
    // score should be > 0
    expect(score).toBeGreaterThan(0);
  });

  test("unsigned transaction flags VS-04", async () => {
    const decoded = await getDecodedLegacyTransfer();
    const { breakdown } = computeRiskScore(decoded, DEFAULT_RISK_CONFIG);
    const vs04 = breakdown.find((r) => r.id === "VS-04");
    expect(vs04).toBeDefined();
    if (vs04) {
      expect(vs04.severity).toBeGreaterThan(0);
    }
  });
});

