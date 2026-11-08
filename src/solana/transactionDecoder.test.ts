/**
 * @jest-environment node
 */
// src/solana/transactionDecoder.test.ts
import { decodeTransaction } from "./transactionDecoder";
import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  createTransferInstruction,
} from "@solana/spl-token";

const DUMMY_BLOCKHASH = "11111111111111111111111111111111";

/** Helper to create an unsigned legacy SystemProgram transfer base64 */
function createLegacyTransferBase64(lamports = 1_000_000): { base64: string; from: Keypair; to: PublicKey } {
  const from = Keypair.generate();
  const to = Keypair.generate().publicKey;
  const tx = new Transaction();
  tx.feePayer = from.publicKey;
  tx.recentBlockhash = DUMMY_BLOCKHASH;
  tx.add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports,
    }),
  );
  const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return { base64: Buffer.from(raw).toString("base64"), from, to };
}

/** Helper to create an unsigned v0 SystemProgram transfer base64 */
function createV0TransferBase64(lamports = 500_000): { base64: string; from: Keypair; to: PublicKey } {
  const from = Keypair.generate();
  const to = Keypair.generate().publicKey;
  const ix = SystemProgram.transfer({
    fromPubkey: from.publicKey,
    toPubkey: to,
    lamports,
  });
  const msgV0 = new TransactionMessage({
    payerKey: from.publicKey,
    recentBlockhash: DUMMY_BLOCKHASH,
    instructions: [ix],
  }).compileToV0Message();
  const vtx = new VersionedTransaction(msgV0);
  const raw = vtx.serialize();
  return { base64: Buffer.from(raw).toString("base64"), from, to };
}

describe("Transaction Decoder — Legacy & v0 Basics", () => {
  test("decodes legacy SystemProgram transfer", async () => {
    const { base64, from, to } = createLegacyTransferBase64(1_000_000);
    const decoded = await decodeTransaction(base64);

    expect(decoded.version).toBe("legacy");
    expect(decoded.signatures).toEqual([]);
    expect(decoded.instructions).toHaveLength(1);

    const sysInstr = decoded.instructions[0];
    expect(sysInstr.programName).toBe("SystemProgram");
    expect(sysInstr.programId).toBe(SystemProgram.programId.toBase58());
    expect(sysInstr.isUnsupported).toBe(false);
    expect(sysInstr.instructionIndex).toBe(0);
    expect(sysInstr.accounts).toEqual([
      { pubkey: from.publicKey.toBase58(), isSigner: true, isWritable: true },
      { pubkey: to.toBase58(), isSigner: false, isWritable: true },
    ]);
    expect(sysInstr.data).toEqual({
      type: "Transfer",
      lamports: 1_000_000,
    });
  });

  test("decodes legacy signed transaction and extracts signatures", async () => {
    const from = Keypair.generate();
    const to = Keypair.generate().publicKey;
    const tx = new Transaction();
    tx.feePayer = from.publicKey;
    tx.recentBlockhash = DUMMY_BLOCKHASH;
    tx.add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: 2_000 }));
    tx.sign(from);

    const raw = tx.serialize();
    const base64 = Buffer.from(raw).toString("base64");
    const decoded = await decodeTransaction(base64);

    expect(decoded.version).toBe("legacy");
    expect(decoded.signatures.length).toBe(1);
    expect(typeof decoded.signatures[0]).toBe("string");
  });

  test("decodes v0 transaction without lookup tables", async () => {
    const { base64, from, to } = createV0TransferBase64(500_000);
    const decoded = await decodeTransaction(base64);

    expect(decoded.version).toBe("v0");
    expect(decoded.signatures).toEqual([]);
    expect(decoded.instructions).toHaveLength(1);

    const sysInstr = decoded.instructions[0];
    expect(sysInstr.programName).toBe("SystemProgram");
    expect(sysInstr.isUnsupported).toBe(false);
    expect(sysInstr.instructionIndex).toBe(0);
    expect(sysInstr.accounts[0].pubkey).toBe(from.publicKey.toBase58());
    expect(sysInstr.accounts[0].isSigner).toBe(true);
    expect(sysInstr.accounts[0].isWritable).toBe(true);
    expect(sysInstr.accounts[1].pubkey).toBe(to.toBase58());
    expect(sysInstr.accounts[1].isSigner).toBe(false);
    expect(sysInstr.accounts[1].isWritable).toBe(true);
    expect(sysInstr.data).toEqual({
      type: "Transfer",
      lamports: 500_000,
    });
  });

  test("decodes SPL Token and Token-2022 instructions cleanly", async () => {
    const owner = Keypair.generate();
    const source = Keypair.generate().publicKey;
    const destination = Keypair.generate().publicKey;

    // SPL Token transfer
    const splIx = createTransferInstruction(source, destination, owner.publicKey, 42_000, [], TOKEN_PROGRAM_ID);
    const msgSpl = new TransactionMessage({
      payerKey: owner.publicKey,
      recentBlockhash: DUMMY_BLOCKHASH,
      instructions: [splIx],
    }).compileToV0Message();
    const vtxSpl = new VersionedTransaction(msgSpl);
    const base64Spl = Buffer.from(vtxSpl.serialize()).toString("base64");

    const decodedSpl = await decodeTransaction(base64Spl);
    expect(decodedSpl.instructions[0].programName).toBe("TokenProgram");
    expect(decodedSpl.instructions[0].isUnsupported).toBe(false);
    expect((decodedSpl.instructions[0].data as any).type).toBe("Transfer");
    expect((decodedSpl.instructions[0].data as any).amount).toBe(42_000);

    // Token-2022 transfer
    const t22Ix = createTransferInstruction(source, destination, owner.publicKey, 99_000, [], TOKEN_2022_PROGRAM_ID);
    const msgT22 = new TransactionMessage({
      payerKey: owner.publicKey,
      recentBlockhash: DUMMY_BLOCKHASH,
      instructions: [t22Ix],
    }).compileToV0Message();
    const vtxT22 = new VersionedTransaction(msgT22);
    const base64T22 = Buffer.from(vtxT22.serialize()).toString("base64");

    const decodedT22 = await decodeTransaction(base64T22);
    expect(decodedT22.instructions[0].programName).toBe("Token2022Program");
    expect(decodedT22.instructions[0].isUnsupported).toBe(false);
    expect((decodedT22.instructions[0].data as any).type).toBe("Transfer");
    expect((decodedT22.instructions[0].data as any).amount).toBe(99_000);
  });
});

describe("Transaction Decoder — Phase 3 Token & Token-2022 Instructions", () => {
  const payer = Keypair.generate();
  const source = Keypair.generate().publicKey;
  const destination = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const delegate = Keypair.generate().publicKey;
  const newAuthority = Keypair.generate().publicKey;

  test("decodes SPL Token TransferChecked with explicit decimals", async () => {
    const { createTransferCheckedInstruction } = require("@solana/spl-token");
    const ix = createTransferCheckedInstruction(
      source,
      mint,
      destination,
      payer.publicKey,
      1_500_000n, // 1.5 tokens with 6 decimals
      6,
      [],
      TOKEN_PROGRAM_ID,
    );
    const msg = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: DUMMY_BLOCKHASH,
      instructions: [ix],
    }).compileToV0Message();
    const base64 = Buffer.from(new VersionedTransaction(msg).serialize()).toString("base64");

    const decoded = await decodeTransaction(base64);
    const data = decoded.instructions[0].data as any;
    expect(decoded.instructions[0].programName).toBe("TokenProgram");
    expect(data.type).toBe("TransferChecked");
    expect(data.amount).toBe(1_500_000);
    expect(data.rawTokenAmount).toBe("1500000");
    expect(data.formattedTokenAmount).toBe("1.5");
    expect(data.isFormattedWithDecimals).toBe(true);
    expect(data.decimals).toBe(6);
  });

  test("decodes SPL Token Approve and Revoke instructions", async () => {
    const { createApproveInstruction, createRevokeInstruction } = require("@solana/spl-token");
    const appIx = createApproveInstruction(source, delegate, payer.publicKey, 750n, [], TOKEN_PROGRAM_ID);
    const revIx = createRevokeInstruction(source, payer.publicKey, [], TOKEN_PROGRAM_ID);

    const tx = new Transaction();
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = DUMMY_BLOCKHASH;
    tx.add(appIx, revIx);
    const base64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");

    const decoded = await decodeTransaction(base64);
    expect(decoded.instructions).toHaveLength(2);

    const appData = decoded.instructions[0].data as any;
    expect(appData.type).toBe("Approve");
    expect(appData.amount).toBe(750);
    expect(appData.rawTokenAmount).toBe("750");

    const revData = decoded.instructions[1].data as any;
    expect(revData.type).toBe("Revoke");
  });

  test("decodes SPL Token SetAuthority instruction with authorityTypeName", async () => {
    const { createSetAuthorityInstruction, AuthorityType } = require("@solana/spl-token");
    const saIx = createSetAuthorityInstruction(
      source,
      payer.publicKey,
      AuthorityType.AccountOwner,
      newAuthority,
      [],
      TOKEN_PROGRAM_ID,
    );
    const tx = new Transaction();
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = DUMMY_BLOCKHASH;
    tx.add(saIx);
    const base64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");

    const decoded = await decodeTransaction(base64);
    const data = decoded.instructions[0].data as any;
    expect(data.type).toBe("SetAuthority");
    expect(data.authorityTypeName).toBe("AccountOwner");
  });

  test("decodes SPL Token CloseAccount instruction", async () => {
    const { createCloseAccountInstruction } = require("@solana/spl-token");
    const caIx = createCloseAccountInstruction(source, destination, payer.publicKey, [], TOKEN_PROGRAM_ID);
    const tx = new Transaction();
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = DUMMY_BLOCKHASH;
    tx.add(caIx);
    const base64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");

    const decoded = await decodeTransaction(base64);
    const data = decoded.instructions[0].data as any;
    expect(data.type).toBe("CloseAccount");
  });

  test("decodes SPL Token MintTo and Burn instructions", async () => {
    const { createMintToInstruction, createBurnInstruction } = require("@solana/spl-token");
    const mintIx = createMintToInstruction(mint, destination, payer.publicKey, 10_000n, [], TOKEN_PROGRAM_ID);
    const burnIx = createBurnInstruction(source, mint, payer.publicKey, 2_000n, [], TOKEN_PROGRAM_ID);

    const tx = new Transaction();
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = DUMMY_BLOCKHASH;
    tx.add(mintIx, burnIx);
    const base64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");

    const decoded = await decodeTransaction(base64);
    expect((decoded.instructions[0].data as any).type).toBe("MintTo");
    expect((decoded.instructions[0].data as any).amount).toBe(10_000);
    expect((decoded.instructions[1].data as any).type).toBe("Burn");
    expect((decoded.instructions[1].data as any).amount).toBe(2_000);
  });

  test("identifies unsupported Token-2022 extension instructions and preserves raw data", async () => {
    // Discriminator >= 20 represents extension instructions in Token-2022
    const extIx = new TransactionInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      keys: [{ pubkey: source, isSigner: false, isWritable: true }],
      data: Buffer.from([26, 0x01, 0x02, 0x03]), // TransferFee extension discriminator
    });
    const tx = new Transaction();
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = DUMMY_BLOCKHASH;
    tx.add(extIx);
    const base64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");

    const decoded = await decodeTransaction(base64);
    const instr = decoded.instructions[0];
    expect(instr.isUnsupported).toBe(true);
    expect(instr.programName).toBe("Token2022Program");
    expect(instr.unsupportedReason).toContain("Unsupported Token-2022 extension instruction");
    expect(instr.rawBase64Data).toBe(Buffer.from([26, 0x01, 0x02, 0x03]).toString("base64"));
  });

  test("labels raw amount when mint metadata is missing, formats amount when known decimals supplied", async () => {
    const { createTransferInstruction } = require("@solana/spl-token");
    const rawAmount = 12_345_678n;
    const ix = createTransferInstruction(source, destination, payer.publicKey, rawAmount, [], TOKEN_PROGRAM_ID);
    const tx = new Transaction();
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = DUMMY_BLOCKHASH;
    tx.add(ix);
    const base64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");

    // Case A: Missing mint metadata
    const decodedWithoutMetadata = await decodeTransaction(base64);
    const dataA = decodedWithoutMetadata.instructions[0].data as any;
    expect(dataA.rawTokenAmount).toBe("12345678");
    expect(dataA.formattedTokenAmount).toBeUndefined();
    expect(dataA.isFormattedWithDecimals).toBeUndefined();

    // Case B: Known decimals supplied via options
    const decodedWithMetadata = await decodeTransaction(base64, {
      mintDecimals: {
        [mint.toBase58()]: 6,
      },
    });
    expect((decodedWithMetadata.instructions[0].data as any).rawTokenAmount).toBe("12345678");
  });
});

describe("Transaction Decoder — Address Lookup Tables (ALTs)", () => {
  test("v0 transaction with writable ALT addresses resolves complete account list and writable status", async () => {
    const payer = Keypair.generate();
    const altKey = Keypair.generate().publicKey;

    // Create 3 ALT addresses
    const altAddr0 = Keypair.generate().publicKey;
    const altAddr1 = Keypair.generate().publicKey;
    const altAddr2 = Keypair.generate().publicKey;

    const altAccount = new AddressLookupTableAccount({
      key: altKey,
      state: {
        deactivationSlot: BigInt(0),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: Keypair.generate().publicKey,
        addresses: [altAddr0, altAddr1, altAddr2],
      },
    });

    // Custom instruction targeting altAddr0 as writable account loaded from ALT
    const customProgramId = Keypair.generate().publicKey;
    const ix = new TransactionInstruction({
      programId: customProgramId,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: altAddr0, isSigner: false, isWritable: true }, // writable ALT address
      ],
      data: Buffer.from([0x01, 0x02, 0x03]),
    });

    const msgV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: DUMMY_BLOCKHASH,
      instructions: [ix],
    }).compileToV0Message([altAccount]);

    expect(msgV0.addressTableLookups.length).toBe(1);
    expect(msgV0.addressTableLookups[0].writableIndexes).toContain(0);

    const vtx = new VersionedTransaction(msgV0);
    const base64 = Buffer.from(vtx.serialize()).toString("base64");

    // Decode with preloaded ALT account
    const decoded = await decodeTransaction(base64, [altAccount]);

    expect(decoded.version).toBe("v0");
    expect(decoded.instructions).toHaveLength(1);
    const decodedIx = decoded.instructions[0];

    // Verify program ID
    expect(decodedIx.programId).toBe(customProgramId.toBase58());
    // Verify accounts
    expect(decodedIx.accounts).toHaveLength(2);
    expect(decodedIx.accounts[0].pubkey).toBe(payer.publicKey.toBase58());
    expect(decodedIx.accounts[0].isSigner).toBe(true);
    expect(decodedIx.accounts[0].isWritable).toBe(true);

    // Verified: Loaded writable ALT account resolved to exact public key with isWritable = true
    expect(decodedIx.accounts[1].pubkey).toBe(altAddr0.toBase58());
    expect(decodedIx.accounts[1].isSigner).toBe(false);
    expect(decodedIx.accounts[1].isWritable).toBe(true);

    // Verify complete accountKeys reconstruction order: static then writable ALT then readonly ALT
    expect(decoded.message.accountKeys).toContain(altAddr0.toBase58());
    const staticCount = msgV0.staticAccountKeys.length;
    expect(decoded.message.accountKeys[staticCount]).toBe(altAddr0.toBase58());
  });

  test("v0 transaction with readonly ALT addresses resolves account and readonly status", async () => {
    const payer = Keypair.generate();
    const altKey = Keypair.generate().publicKey;
    const readonlyAddr = Keypair.generate().publicKey;

    const altAccount = new AddressLookupTableAccount({
      key: altKey,
      state: {
        deactivationSlot: BigInt(0),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: Keypair.generate().publicKey,
        addresses: [readonlyAddr],
      },
    });

    const customProgramId = Keypair.generate().publicKey;
    const ix = new TransactionInstruction({
      programId: customProgramId,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: readonlyAddr, isSigner: false, isWritable: false }, // readonly ALT address
      ],
      data: Buffer.from([0xaa]),
    });

    const msgV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: DUMMY_BLOCKHASH,
      instructions: [ix],
    }).compileToV0Message([altAccount]);

    expect(msgV0.addressTableLookups[0].readonlyIndexes).toContain(0);

    const vtx = new VersionedTransaction(msgV0);
    const base64 = Buffer.from(vtx.serialize()).toString("base64");

    const decoded = await decodeTransaction(base64, [altAccount]);
    const decodedIx = decoded.instructions[0];

    expect(decodedIx.accounts[1].pubkey).toBe(readonlyAddr.toBase58());
    expect(decodedIx.accounts[1].isSigner).toBe(false);
    expect(decodedIx.accounts[1].isWritable).toBe(false);
  });

  test("v0 transaction with ALT resolved via RPC Connection mock", async () => {
    const payer = Keypair.generate();
    const altKey = Keypair.generate().publicKey;
    const altRecipient = Keypair.generate().publicKey;

    const altAccount = new AddressLookupTableAccount({
      key: altKey,
      state: {
        deactivationSlot: BigInt(0),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: Keypair.generate().publicKey,
        addresses: [altRecipient],
      },
    });

    const ix = SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: altRecipient,
      lamports: 100_000,
    });

    const msgV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: DUMMY_BLOCKHASH,
      instructions: [ix],
    }).compileToV0Message([altAccount]);

    const vtx = new VersionedTransaction(msgV0);
    const base64 = Buffer.from(vtx.serialize()).toString("base64");

    // Mock Connection that returns altAccount for altKey
    const mockConnection = {
      getAddressLookupTable: jest.fn().mockImplementation(async (key: PublicKey) => {
        if (key.equals(altKey)) {
          return { value: altAccount };
        }
        return { value: null };
      }),
    } as unknown as Connection;

    const decoded = await decodeTransaction(base64, mockConnection);
    expect(mockConnection.getAddressLookupTable).toHaveBeenCalledWith(altKey);
    expect(decoded.instructions[0].accounts[1].pubkey).toBe(altRecipient.toBase58());
    expect(decoded.unresolvedLookupTables).toBeUndefined();
  });

  test("missing lookup table reports explicit unresolvedLookupTables and warning without crashing", async () => {
    const payer = Keypair.generate();
    const altKey = Keypair.generate().publicKey;
    const altAddr = Keypair.generate().publicKey;

    const altAccount = new AddressLookupTableAccount({
      key: altKey,
      state: {
        deactivationSlot: BigInt(0),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: Keypair.generate().publicKey,
        addresses: [altAddr],
      },
    });

    const ix = new TransactionInstruction({
      programId: Keypair.generate().publicKey,
      keys: [{ pubkey: altAddr, isSigner: false, isWritable: true }],
      data: Buffer.from([0x01]),
    });

    const msgV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: DUMMY_BLOCKHASH,
      instructions: [ix],
    }).compileToV0Message([altAccount]);

    const vtx = new VersionedTransaction(msgV0);
    const base64 = Buffer.from(vtx.serialize()).toString("base64");

    // Pass empty array - lookup table missing
    const decoded = await decodeTransaction(base64, []);

    expect(decoded.unresolvedLookupTables).toBeDefined();
    expect(decoded.unresolvedLookupTables).toHaveLength(1);
    expect(decoded.unresolvedLookupTables![0].lookupTableKey).toBe(altKey.toBase58());
    expect(decoded.unresolvedLookupTables![0].reason).toBe("table_not_found");
    expect(decoded.warnings).toBeDefined();
    expect(decoded.warnings![0]).toMatch(/Address Lookup Table/);

    // The instruction references an out-of-bounds account index because the ALT was not loaded
    expect(decoded.instructions[0].isUnsupported).toBe(true);
    expect(decoded.instructions[0].unsupportedReason).toMatch(/out-of-bounds/);
  });

  test("RPC lookup failure reports fetch_failed in unresolvedLookupTables", async () => {
    const payer = Keypair.generate();
    const altKey = Keypair.generate().publicKey;
    const altAddr = Keypair.generate().publicKey;

    const altAccount = new AddressLookupTableAccount({
      key: altKey,
      state: {
        deactivationSlot: BigInt(0),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: Keypair.generate().publicKey,
        addresses: [altAddr],
      },
    });

    const ix = new TransactionInstruction({
      programId: Keypair.generate().publicKey,
      keys: [{ pubkey: altAddr, isSigner: false, isWritable: true }],
      data: Buffer.from([0x01]),
    });

    const msgV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: DUMMY_BLOCKHASH,
      instructions: [ix],
    }).compileToV0Message([altAccount]);

    const vtx = new VersionedTransaction(msgV0);
    const base64 = Buffer.from(vtx.serialize()).toString("base64");

    const failingConn = {
      getAddressLookupTable: jest.fn().mockRejectedValue(new Error("RPC Timeout 504")),
    } as unknown as Connection;

    const decoded = await decodeTransaction(base64, failingConn);
    expect(decoded.unresolvedLookupTables).toBeDefined();
    expect(decoded.unresolvedLookupTables![0].reason).toBe("fetch_failed");
    expect(decoded.unresolvedLookupTables![0].details).toContain("RPC Timeout 504");
  });

  test("invalid lookup table index reports index_out_of_bounds", async () => {
    const payer = Keypair.generate();
    const altKey = Keypair.generate().publicKey;
    const altAddr = Keypair.generate().publicKey;

    // Account with 2 addresses
    const fullAltAccount = new AddressLookupTableAccount({
      key: altKey,
      state: {
        deactivationSlot: BigInt(0),
        lastExtendedSlot: 0,
        lastExtendedSlotStartIndex: 0,
        authority: Keypair.generate().publicKey,
        addresses: [altAddr, Keypair.generate().publicKey],
      },
    });

    const ix = new TransactionInstruction({
      programId: Keypair.generate().publicKey,
      keys: [{ pubkey: fullAltAccount.state.addresses[1], isSigner: false, isWritable: true }],
      data: Buffer.from([0x01]),
    });

    const msgV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: DUMMY_BLOCKHASH,
      instructions: [ix],
    }).compileToV0Message([fullAltAccount]);

    const vtx = new VersionedTransaction(msgV0);
    const base64 = Buffer.from(vtx.serialize()).toString("base64");

    // Provide an ALT account where index 1 does not exist (truncated to 1 address)
    const truncatedAltAccount = new AddressLookupTableAccount({
      key: altKey,
      state: {
        ...fullAltAccount.state,
        addresses: [altAddr], // only index 0 exists!
      },
    });

    const decoded = await decodeTransaction(base64, [truncatedAltAccount]);
    expect(decoded.unresolvedLookupTables).toBeDefined();
    expect(decoded.unresolvedLookupTables![0].reason).toBe("index_out_of_bounds");
  });
});

describe("Transaction Decoder — Edge Cases & Error Handling", () => {
  test("throws on empty or non-string payload", async () => {
    await expect(decodeTransaction("")).rejects.toThrow(/Invalid transaction payload/);
    await expect(decodeTransaction("   ")).rejects.toThrow(/Invalid transaction payload/);
    await expect(decodeTransaction(null as any)).rejects.toThrow(/Invalid transaction payload/);
  });

  test("throws on malformed base64 payload", async () => {
    await expect(decodeTransaction("@@@NOT_BASE64@@@")).rejects.toThrow(/Failed to deserialize transaction/);
  });

  test("throws on truncated or corrupted transaction bytes", async () => {
    // 5 bytes of junk
    const corruptedBase64 = Buffer.from([1, 2, 3, 4, 5]).toString("base64");
    await expect(decodeTransaction(corruptedBase64)).rejects.toThrow(/Failed to deserialize transaction/);
  });

  test("preserves unsupported instruction data and records rawBase64Data and reason", async () => {
    const from = Keypair.generate();
    const unknownProgram = Keypair.generate().publicKey;
    const testData = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02]);

    const ix = new TransactionInstruction({
      programId: unknownProgram,
      keys: [{ pubkey: from.publicKey, isSigner: true, isWritable: true }],
      data: testData,
    });

    const msgV0 = new TransactionMessage({
      payerKey: from.publicKey,
      recentBlockhash: DUMMY_BLOCKHASH,
      instructions: [ix],
    }).compileToV0Message();

    const vtx = new VersionedTransaction(msgV0);
    const base64 = Buffer.from(vtx.serialize()).toString("base64");

    const decoded = await decodeTransaction(base64);
    expect(decoded.instructions).toHaveLength(1);
    const decodedIx = decoded.instructions[0];

    expect(decodedIx.isUnsupported).toBe(true);
    expect(decodedIx.programName).toBe("Unknown");
    expect(decodedIx.rawBase64Data).toBe(testData.toString("base64"));
    expect(decodedIx.unsupportedReason).toContain("unsupported or unverified");
  });

  test("throws on unsupported transaction version", async () => {
    const { base64 } = createV0TransferBase64();
    const raw = Buffer.from(base64, "base64");

    // In Solana versioned wire format: byte 0 is num signatures, followed by 64 bytes of sig.
    // The next byte has the high bit set (0x80) and lower 7 bits are the version number.
    // Let's modify the version byte from 0 (0x80) to version 2 (0x82).
    const versionByteOffset = 1 + 64;
    raw[versionByteOffset] = 0x80 | 2; // version 2

    const mutatedBase64 = raw.toString("base64");
    await expect(decodeTransaction(mutatedBase64)).rejects.toThrow(/deserialization is not supported|Unsupported transaction version/);
  });
});
