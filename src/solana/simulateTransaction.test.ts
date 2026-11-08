/**
 * @jest-environment node
 */
// src/solana/simulateTransaction.test.ts
import { simulateTransaction } from "./simulateTransaction";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

const DUMMY_BLOCKHASH = "11111111111111111111111111111111";

function createLegacyTransferBase64(isSigned = false): string {
  const from = Keypair.generate();
  const to = Keypair.generate().publicKey;
  const tx = new Transaction();
  tx.feePayer = from.publicKey;
  tx.recentBlockhash = DUMMY_BLOCKHASH;
  tx.add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: 1_000 }));
  if (isSigned) {
    tx.sign(from);
    return Buffer.from(tx.serialize()).toString("base64");
  }
  return Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");
}

function createV0TransferBase64(isSigned = false): string {
  const from = Keypair.generate();
  const to = Keypair.generate().publicKey;
  const ix = SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: 5_000 });
  const msgV0 = new TransactionMessage({
    payerKey: from.publicKey,
    recentBlockhash: DUMMY_BLOCKHASH,
    instructions: [ix],
  }).compileToV0Message();
  const vtx = new VersionedTransaction(msgV0);
  if (isSigned) {
    vtx.sign([from]);
  }
  return Buffer.from(vtx.serialize()).toString("base64");
}

describe("simulateTransaction — Phase 4 Transaction Simulation", () => {
  test("unsigned transaction simulation configures sigVerify: false so signatures are not required", async () => {
    const base64Tx = createLegacyTransferBase64(false);
    let capturedConfig: any = null;

    const mockConn = {
      getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM" }),
      simulateTransaction: jest.fn().mockImplementation(async (tx: any, config: any) => {
        capturedConfig = config;
        return {
          context: { slot: 100 },
          value: {
            err: null,
            logs: ["Program 11111111111111111111111111111111 invoke [1]", "success"],
            unitsConsumed: 150,
          },
        };
      }),
    } as unknown as Connection;

    const res = await simulateTransaction(base64Tx, mockConn);

    expect(mockConn.simulateTransaction).toHaveBeenCalled();
    expect(capturedConfig).toBeDefined();
    expect(capturedConfig.sigVerify).toBe(false); // Verified: unsigned simulation disables sigVerify
    expect(res.status).toBe("success_with_warnings"); // recentBlockhash substitution warning
    expect(res.logs).toEqual(["Program 11111111111111111111111111111111 invoke [1]", "success"]);
    expect(res.computeUnitsConsumed).toBe(150);
    expect(res.slot).toBe(100);
    expect(res.limitations.length).toBeGreaterThan(0);
  });

  test("signed transaction simulation configures sigVerify: true", async () => {
    const base64Tx = createV0TransferBase64(true);
    let capturedConfig: any = null;

    const mockConn = {
      getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM" }),
      simulateTransaction: jest.fn().mockImplementation(async (tx: any, config: any) => {
        capturedConfig = config;
        return {
          context: { slot: 101 },
          value: { err: null, logs: ["success"], unitsConsumed: 200 },
        };
      }),
    } as unknown as Connection;

    const res = await simulateTransaction(base64Tx, mockConn);

    expect(capturedConfig).toBeDefined();
    expect(capturedConfig.sigVerify).toBe(true); // Verified: signed simulation enables sigVerify
    expect(res.status).toBe("success_with_warnings");
  });

  test("handles RPC simulation error returned gracefully without marking malicious", async () => {
    const base64Tx = createLegacyTransferBase64(false);

    const mockConn = {
      getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM" }),
      simulateTransaction: jest.fn().mockResolvedValue({
        context: { slot: 102 },
        value: {
          err: { InstructionError: [0, "Custom: 1"] },
          logs: ["Program 11111111111111111111111111111111 failed"],
          unitsConsumed: 80,
        },
      }),
    } as unknown as Connection;

    const res = await simulateTransaction(base64Tx, mockConn);

    expect(res.status).toBe("failed");
    expect(res.error).toBeDefined();
    expect(res.errorMessage).toContain("InstructionError");
    expect(res.logs).toBeDefined();
    // Honest disclosure: failure alone does not mean malicious
    expect(res.limitations.some((l) => l.includes("Simulation failure is not proof of malicious intent"))).toBe(true);
  });

  test("handles RPC network error / timeout and reports status unavailable", async () => {
    const base64Tx = createLegacyTransferBase64(false);

    const mockConn = {
      getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM" }),
      simulateTransaction: jest.fn().mockRejectedValue(new Error("Connection refused or timeout after 30000ms")),
    } as unknown as Connection;

    const res = await simulateTransaction(base64Tx, mockConn);

    expect(res.status).toBe("unavailable");
    expect(res.errorMessage).toContain("Connection refused or timeout");
    expect(res.hasFullAccountDiff).toBe(false);
  });

  test("handles empty or malformed base64 input gracefully", async () => {
    const mockConn = {} as Connection;

    const resEmpty = await simulateTransaction("", mockConn);
    expect(resEmpty.status).toBe("unavailable");
    expect(resEmpty.errorMessage).toContain("Empty or invalid");

    const resMalformed = await simulateTransaction("@@@NOT_BASE64@@@", mockConn);
    expect(resMalformed.status).toBe("unavailable");
    expect(resMalformed.errorMessage).toContain("Failed to deserialize transaction");
  });

  test("captures returned account data when accounts are requested", async () => {
    const base64Tx = createV0TransferBase64(false);
    const targetAccount = Keypair.generate().publicKey;

    const mockConn = {
      getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM" }),
      simulateTransaction: jest.fn().mockResolvedValue({
        context: { slot: 105 },
        value: {
          err: null,
          logs: ["success"],
          unitsConsumed: 300,
          accounts: [
            {
              executable: false,
              owner: "11111111111111111111111111111111",
              lamports: 10_000_000,
              data: ["AQID", "base64"],
            },
          ],
        },
      }),
    } as unknown as Connection;

    const res = await simulateTransaction(base64Tx, mockConn, {
      accounts: [targetAccount],
    });

    expect(res.returnedAccounts).toBeDefined();
    expect(res.returnedAccounts![targetAccount.toBase58()]).toBe("AQID");
    expect(res.hasFullAccountDiff).toBe(true);
  });

  test("handles missing optional simulation response fields safely", async () => {
    const base64Tx = createLegacyTransferBase64(false);

    const mockConn = {
      getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM" }),
      simulateTransaction: jest.fn().mockResolvedValue({
        context: { slot: 106 },
        value: {
          err: null,
          // no logs, unitsConsumed, returnData, accounts
        },
      }),
    } as unknown as Connection;

    const res = await simulateTransaction(base64Tx, mockConn);

    expect(res.status).toBe("success_with_warnings");
    expect(res.logs).toBeUndefined();
    expect(res.computeUnitsConsumed).toBeUndefined();
    expect(res.hasFullAccountDiff).toBe(false);
  });

  test("handles unsupported or malformed simulation response value", async () => {
    const base64Tx = createLegacyTransferBase64(false);

    const mockConn = {
      getLatestBlockhash: jest.fn().mockResolvedValue({ blockhash: "4uQeVj5tqViQh7yWWGStvkEG1Zmhx6uasJtWCJziofM" }),
      simulateTransaction: jest.fn().mockResolvedValue({
        context: { slot: 107 },
        value: null as any,
      }),
    } as unknown as Connection;

    const res = await simulateTransaction(base64Tx, mockConn);

    expect(res.status).toBe("unavailable");
    expect(res.warnings).toBeDefined();
  });
});
