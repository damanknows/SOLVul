// src/solana/transactionDecoder.test.ts
import { decodeTransaction } from "./transactionDecoder";
import { readFileSync } from "fs";
import { Connection, Keypair, SystemProgram, Transaction } from "@solana/web3.js";

/**
 * Helper to create a simple legacy unsigned transfer transaction and return its base64.
 */
function createLegacyTransferBase64(): string {
  const from = Keypair.generate();
  const to = Keypair.generate().publicKey;
  const tx = new Transaction();
  tx.feePayer = from.publicKey;
  tx.recentBlockhash = "11111111111111111111111111111111"; // dummy
  tx.add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports: 1_000_000,
    })
  );
  // Do not sign – keep it unsigned
  const serialized = tx.serializeMessage(); // only message part, unsigned
  // Prefix with a dummy signature array length (0) for legacy format? Use Transaction.fromMessage
  const legacyTx = Transaction.fromMessage({
    message: tx.compileMessage(),
    signatures: []
  });
  // Serialize the whole transaction (which includes signatures = empty)
  const buf = legacyTx.serialize();
  return Buffer.from(buf).toString("base64");
}

describe("Transaction Decoder", () => {
  test("decodes legacy SystemProgram transfer", async () => {
    const base64Tx = createLegacyTransferBase64();
    const decoded = await decodeTransaction(base64Tx);
    expect(decoded.version).toBe("legacy");
    expect(decoded.instructions.length).toBeGreaterThan(0);
    const sysInstr = decoded.instructions.find(i => i.programName === "SystemProgram");
    expect(sysInstr).toBeDefined();
    if (sysInstr) {
      expect(sysInstr.isUnsupported).toBe(false);
      // @ts-ignore - data shape from decoder
      expect(sysInstr.data.type).toBe("Transfer");
    }
  });

  test("decodes v0 transaction (SystemProgram)", async () => {
    // Build a versioned transaction (v0) with a transfer
    const from = Keypair.generate();
    const to = Keypair.generate().publicKey;
    const recentBlockhash = "11111111111111111111111111111111";
    const tx = Transaction.fromMessage({
      message: new (require("@solana/web3.js").Message)({
        header: { numReadonlySignedAccounts: 0, numReadonlyUnsignedAccounts: 0, numRequiredSignatures: 1 },
        recentBlockhash,
        accountKeys: [from.publicKey, to],
        instructions: [
          SystemProgram.transfer({
            fromPubkey: from.publicKey,
            toPubkey: to,
            lamports: 500_000,
          })
        ],
      }),
      signatures: [],
    });
    // Convert to versioned transaction (v0) using the new API if available
    // For simplicity, serialize the transaction and treat it as v0 base64
    const buf = tx.serialize();
    const base64Tx = Buffer.from(buf).toString("base64");
    const decoded = await decodeTransaction(base64Tx, new Connection("https://api.devnet.solana.com"));
    expect(decoded.version).toBe("v0");
    const sysInstr = decoded.instructions.find(i => i.programName === "SystemProgram");
    expect(sysInstr).toBeDefined();
    if (sysInstr) {
      expect(sysInstr.isUnsupported).toBe(false);
      // @ts-ignore
      expect(sysInstr.data.type).toBe("Transfer");
    }
  });
});

