// src/components/inspector/__tests__/accountDiffParser.test.ts
import { computeAccountDiffMatrix } from "../accountDiffParser";
import type { DecodedTransaction } from "../../../solana/transactionDecoder";
import type { SimulationResult } from "../../../solana/simulateTransaction";

describe("Account State Diff Matrix Parser", () => {
  const payerPubkey = "Payer11111111111111111111111111111111111111";
  const recipientPubkey = "Recipient1111111111111111111111111111111111";
  const systemProgramId = "11111111111111111111111111111111";
  const maliciousProgramId = "AttackerMaliciousProgram11111111111111111111";

  const transferTx: DecodedTransaction = {
    version: "legacy",
    signatures: [],
    message: {
      accountKeys: [payerPubkey, recipientPubkey, systemProgramId],
      recentBlockhash: "11111111111111111111111111111111",
      instructionCount: 1,
    },
    instructions: [
      {
        programId: systemProgramId,
        programName: "SystemProgram",
        isUnsupported: false,
        accounts: [
          { pubkey: payerPubkey, isSigner: true, isWritable: true },
          { pubkey: recipientPubkey, isSigner: false, isWritable: true },
        ],
        data: { type: "Transfer", lamports: 50_000_000 }, // 0.05 SOL
      },
    ],
  };

  test("1. Computes pre/post lamport delta statically and badges 'Inferred from Static Instruction'", () => {
    const diffs = computeAccountDiffMatrix(transferTx, null);

    const payerDiff = diffs.find((d) => d.pubkey === payerPubkey);
    const recipientDiff = diffs.find((d) => d.pubkey === recipientPubkey);

    expect(payerDiff).toBeDefined();
    expect(recipientDiff).toBeDefined();

    expect(payerDiff?.lamportsDelta).toBe(-50_000_000);
    expect(recipientDiff?.lamportsDelta).toBe(50_000_000);

    expect(payerDiff?.provenance).toBe("Inferred from Static Instruction");
    expect(recipientDiff?.provenance).toBe("Inferred from Static Instruction");

    expect(payerDiff?.isOwnerMutated).toBe(false);
    expect(recipientDiff?.isOwnerMutated).toBe(false);
  });

  test("2. Detects account owner mutation (SystemProgram::Assign) and flags isOwnerMutated", () => {
    const assignTx: DecodedTransaction = {
      version: "legacy",
      signatures: [],
      message: {
        accountKeys: [payerPubkey, systemProgramId],
        recentBlockhash: "11111111111111111111111111111111",
        instructionCount: 1,
      },
      instructions: [
        {
          programId: systemProgramId,
          programName: "SystemProgram",
          isUnsupported: false,
          accounts: [
            { pubkey: payerPubkey, isSigner: true, isWritable: true },
          ],
          data: { type: "Assign", programId: maliciousProgramId },
        },
      ],
    };

    const diffs = computeAccountDiffMatrix(assignTx, null);
    const payerDiff = diffs.find((d) => d.pubkey === payerPubkey);

    expect(payerDiff).toBeDefined();
    expect(payerDiff?.isOwnerMutated).toBe(true);
    expect(payerDiff?.preOwner).toBe(systemProgramId);
    expect(payerDiff?.postOwner).toBe(maliciousProgramId);
  });

  test("3. Uses verified validator snapshots and badges 'Verified via RPC Snapshot'", () => {
    const mockSimulation: SimulationResult = {
      status: "success",
      hasFullAccountDiff: true,
      limitations: [],
      accountSnapshots: {
        [payerPubkey]: {
          executable: false,
          owner: systemProgramId,
          lamports: 950_000_000,
          data: ["", "base64"],
        },
        [recipientPubkey]: {
          executable: false,
          owner: systemProgramId,
          lamports: 50_000_000,
          data: ["", "base64"],
        },
      },
    };

    const diffs = computeAccountDiffMatrix(transferTx, mockSimulation);
    const payerDiff = diffs.find((d) => d.pubkey === payerPubkey);

    expect(payerDiff).toBeDefined();
    expect(payerDiff?.provenance).toBe("Verified via RPC Snapshot");
    expect(payerDiff?.postLamports).toBe(950_000_000);
    expect(payerDiff?.notes).toContain("Real bank snapshot retrieved");
  });

  test("4. Always includes fee payer as writable and signer", () => {
    const diffs = computeAccountDiffMatrix(transferTx, null);
    const feePayerDiff = diffs.find((d) => d.pubkey === payerPubkey);

    expect(feePayerDiff?.isWritable).toBe(true);
    expect(feePayerDiff?.isSigner).toBe(true);
    expect(feePayerDiff?.label).toBe("Fee Payer / Payer");
  });

  test("5. Handles null decoded transaction safely", () => {
    expect(computeAccountDiffMatrix(null, null)).toEqual([]);
  });
});
