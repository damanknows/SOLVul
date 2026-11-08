// src/solana/transactionDecoder.ts
import { Buffer } from "buffer";
import type { Connection, PublicKey, Transaction, VersionedTransaction, Message, MessageCompiledInstruction } from "@solana/web3.js";
import { SystemProgram, TransactionInstruction, SystemInstruction, VersionedTransaction as VTx, Transaction as Tx } from "@solana/web3.js";
import { decodeInstruction as decodeSplTokenInstruction } from "@solana/spl-token";
import { decodeInstruction as decodeToken2022Instruction } from "@solana/spl-token"; // same package supports Token‑2022 via token2022

/**
 * SDK compatibility check – VersionedTransaction was added in @solana/web3.js v1.9.
 */
const hasVersionedTx = typeof VTx !== "undefined";

/**
 * Known program IDs.
 */
const PROGRAM_IDS = {
  SystemProgram: SystemProgram.programId.toBase58(),
  TokenProgram: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  Token2022Program: "TokenzQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", // placeholder – real ID is Token2022 program id
};

/**
 * Resulting decoded instruction description.
 */
export interface DecodedInstruction {
  programId: string;
  programName: string;
  isUnsupported: boolean;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: unknown;
}

/**
 * Overall decoded transaction information.
 */
export interface DecodedTransaction {
  version: "legacy" | "v0";
  signatures: string[]; // base58 signatures (empty for unsigned)
  message: {
    accountKeys: string[];
    recentBlockhash: string;
    instructionCount: number;
  };
  instructions: DecodedInstruction[];
}

/**
 * Helper to resolve address lookup tables for a v0 transaction.
 * Returns a map of address table address -> array of looked‑up account pubkeys (base58).
 */
export async function resolveAddressLookupTables(
  tx: VersionedTransaction,
  connection: Connection,
): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  const lookups = (tx.message as any).addressTableLookups ?? [];
  for (const lookup of lookups) {
    try {
      const tableAccount = await connection.getAddressLookupTable(lookup.accountKey);
      // Resolve indexes into the table's addresses
      const addresses: PublicKey[] = [];
      const { writableIndexes, readOnlyIndexes } = lookup;
      const allIndexes = [...writableIndexes, ...readOnlyIndexes];
      for (const idx of allIndexes) {
        const addr = tableAccount?.state?.addresses[idx];
        if (addr) addresses.push(addr);
      }
      result[lookup.accountKey.toBase58()] = addresses.map(a => a.toBase58());
    } catch (_) {
      result[lookup.accountKey.toBase58()] = [];
    }
  }
  return result;
}

/**
 * Decode a single instruction given its programId and data.
 */
function decodeInstruction(
  instruction: TransactionInstruction,
): DecodedInstruction {
  const programIdStr = instruction.programId.toBase58();
  const accounts = instruction.keys.map(k => ({
    pubkey: k.pubkey.toBase58(),
    isSigner: k.isSigner,
    isWritable: k.isWritable,
  }));

  // System Program decoding
  if (programIdStr === PROGRAM_IDS.SystemProgram) {
    try {
      const type = SystemInstruction.decodeInstructionType(instruction);
      let decoded: unknown = { type };
      if (type === "Transfer") {
        // Data layout: 8-byte lamports little‑endian
        const lamports = Number(instruction.data.readBigInt64LE(0));
        decoded = { type, lamports };
      }
      return { programId: programIdStr, programName: "SystemProgram", isUnsupported: false, accounts, data: decoded };
    } catch (_) {
      // fall through to unsupported
    }
  }

  // SPL Token decoding (legacy token program)
  if (programIdStr === PROGRAM_IDS.TokenProgram) {
    try {
      const decoded = decodeSplTokenInstruction(instruction);
      return { programId: programIdStr, programName: "TokenProgram", isUnsupported: false, accounts, data: decoded };
    } catch (_) {
      // unsupported format
    }
  }

  // Token‑2022 decoding – the same helper can decode if programId matches.
  if (programIdStr === PROGRAM_IDS.Token2022Program) {
    try {
      const decoded = decodeToken2022Instruction(instruction);
      return { programId: programIdStr, programName: "Token2022Program", isUnsupported: false, accounts, data: decoded };
    } catch (_) {
      // unsupported format
    }
  }

  // Unknown / unsupported
  return { programId: programIdStr, programName: "Unknown", isUnsupported: true, accounts, data: instruction.data };
}

/**
 * Main decoder entry point.
 * Accepts a base64‑encoded unsigned transaction (legacy or v0).
 * For v0 transactions a connection can be supplied to resolve address lookup tables.
 */
export async function decodeTransaction(
  base64Tx: string,
  connection?: Connection,
): Promise<DecodedTransaction> {
  const raw = Buffer.from(base64Tx, "base64");

  // Try legacy transaction first
  try {
    const tx = Tx.from(raw) as Transaction;
    const message = tx.compileMessage();
    const decodedInstructions = tx.instructions.map(decodeInstruction);
    return {
      version: "legacy",
      signatures: tx.signatures.map(sig => sig?.toString() ?? ""),
      message: {
        accountKeys: message.accountKeys.map(k => k.toBase58()),
        recentBlockhash: message.recentBlockhash,
        instructionCount: message.instructions.length,
      },
      instructions: decodedInstructions,
    };
  } catch (_) {
    // fall through to v0 handling
  }

  // v0 transaction handling – ensure SDK support
  if (!hasVersionedTx) {
    throw new Error("VersionedTransaction is not supported by the installed @solana/web3.js SDK – cannot decode v0 transactions.");
  }

  // Parse versioned transaction
  const vtx = VTx.from(raw) as VersionedTransaction;
  const message = vtx.message as Message;

  // Resolve address lookup tables if connection provided
  let lookupResolved: Record<string, string[]> = {};
  if (connection) {
    lookupResolved = await resolveAddressLookupTables(vtx, connection);
  }

  // Build full account keys list (including lookup table accounts)
  const compiled = (message as any).compile(); // Message.compile returns compiled version with static accountKeys
  const accountKeys: PublicKey[] = compiled.staticAccountKeys;

  // Decode each compiled instruction
  const decodedInstructions: DecodedInstruction[] = [];
  for (const ix of compiled.compiledInstructions as MessageCompiledInstruction[]) {
    const progId = accountKeys[ix.programIdIndex];
    const keys = ix.accountKeyIndexes.map(idx => {
      const pubkey = accountKeys[idx];
      const isSigner = (ix.accountKeyIndexes.includes(idx) && compiled.isSignerIdxs?.includes(idx)) ?? false;
      const isWritable = (ix.accountKeyIndexes.includes(idx) && compiled.isWritableIdxs?.includes(idx)) ?? false;
      return { pubkey, isSigner, isWritable };
    });
    const instruction = new TransactionInstruction({
      programId: progId,
      keys: keys.map(k => ({ pubkey: k.pubkey, isSigner: k.isSigner, isWritable: k.isWritable })),
      data: Buffer.from(ix.data),
    });
    decodedInstructions.push(decodeInstruction(instruction));
  }

  return {
    version: "v0",
    signatures: vtx.signatures.map(sig => sig?.toString() ?? ""),
    message: {
      accountKeys: accountKeys.map(k => k.toBase58()),
      recentBlockhash: (message as any).recentBlockhash,
      instructionCount: compiled.compiledInstructions.length,
    },
    instructions: decodedInstructions,
  };
}

export default decodeTransaction;

