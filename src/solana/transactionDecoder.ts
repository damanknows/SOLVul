// src/solana/transactionDecoder.ts
import { Buffer } from "buffer";
import type { Connection, PublicKey } from "@solana/web3.js";
import {
  SystemProgram,
  TransactionInstruction,
  SystemInstruction,
  VersionedTransaction as VTx,
  Transaction as Tx,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  decodeInstruction as decodeSplTokenInstruction,
  TokenInstruction,
  AuthorityType,
} from "@solana/spl-token";

/**
 * Official program IDs from installed SDKs.
 */
export const PROGRAM_IDS = {
  SystemProgram: SystemProgram.programId.toBase58(),
  TokenProgram: TOKEN_PROGRAM_ID.toBase58(),
  Token2022Program: TOKEN_2022_PROGRAM_ID.toBase58(),
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
  instructionIndex?: number;
  rawBase64Data?: string;
  unsupportedReason?: string;
}

/**
 * Unresolved Address Lookup Table details.
 */
export interface UnresolvedLookupTable {
  lookupTableKey: string;
  reason: "fetch_failed" | "table_not_found" | "invalid_state" | "index_out_of_bounds" | "no_connection";
  details?: string;
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
    header?: {
      numRequiredSignatures: number;
      numReadonlySignedAccounts: number;
      numReadonlyUnsignedAccounts: number;
    };
  };
  instructions: DecodedInstruction[];
  warnings?: string[];
  unresolvedLookupTables?: UnresolvedLookupTable[];
}

/**
 * Known token mint decimals cache for displaying formatted amounts.
 */
export type MintDecimalsMap = Record<string, number>;

/**
 * Format a raw token amount (base units) using validated mint decimals.
 * If decimals are unavailable or not provided, clearly returns rawAmount with isFormattedWithDecimals: false.
 */
export function formatTokenAmount(
  rawAmount: bigint | number | string,
  decimals?: number | null,
): {
  rawAmount: string;
  formattedAmount: string | null;
  isFormattedWithDecimals: boolean;
  decimals?: number;
} {
  const rawBigInt = typeof rawAmount === "bigint" ? rawAmount : BigInt(rawAmount.toString());
  const rawStr = rawBigInt.toString();

  if (decimals === undefined || decimals === null || isNaN(decimals) || decimals < 0) {
    return {
      rawAmount: rawStr,
      formattedAmount: null,
      isFormattedWithDecimals: false,
    };
  }

  if (decimals === 0) {
    return {
      rawAmount: rawStr,
      formattedAmount: rawStr,
      isFormattedWithDecimals: true,
      decimals: 0,
    };
  }

  const factor = 10n ** BigInt(decimals);
  const integerPart = rawBigInt / factor;
  const fractionalPart = rawBigInt % factor;

  if (fractionalPart === 0n) {
    return {
      rawAmount: rawStr,
      formattedAmount: integerPart.toString(),
      isFormattedWithDecimals: true,
      decimals,
    };
  }

  const fracStr = fractionalPart.toString().padStart(decimals, "0").replace(/0+$/, "");
  return {
    rawAmount: rawStr,
    formattedAmount: `${integerPart.toString()}.${fracStr}`,
    isFormattedWithDecimals: true,
    decimals,
  };
}

/**
 * Helper to resolve address lookup tables for a v0 transaction.
 * Returns a map of address table address -> array of looked-up account pubkeys (base58).
 */
export async function resolveAddressLookupTables(
  tx: VTx,
  connection: Connection,
): Promise<Record<string, string[]>> {
  const result: Record<string, string[]> = {};
  const message = tx.message as any;
  const lookups = message.addressTableLookups ?? [];

  for (const lookup of lookups) {
    const tableKey = lookup.accountKey.toBase58();
    try {
      const tableAccount = await connection.getAddressLookupTable(lookup.accountKey);
      if (!tableAccount || !tableAccount.value || !tableAccount.value.state) {
        result[tableKey] = [];
        continue;
      }
      const stateAddresses: PublicKey[] = tableAccount.value.state.addresses ?? [];
      const addresses: PublicKey[] = [];
      const { writableIndexes, readOnlyIndexes } = lookup;
      const allIndexes = [...writableIndexes, ...readOnlyIndexes];
      for (const idx of allIndexes) {
        const addr = stateAddresses[idx];
        if (addr) addresses.push(addr);
      }
      result[tableKey] = addresses.map((a) => a.toBase58());
    } catch (_) {
      result[tableKey] = [];
    }
  }
  return result;
}

/**
 * Helper to serialize SPL Token decoded keys into a plain object of base58 strings.
 */
function serializeDecodedKeys(keys: any): Record<string, any> {
  const res: Record<string, any> = {};
  if (!keys || typeof keys !== "object") return res;
  for (const [keyName, keyVal] of Object.entries(keys)) {
    if (keyVal && typeof keyVal === "object" && "pubkey" in keyVal) {
      res[keyName] = (keyVal as any).pubkey.toBase58();
    } else if (Array.isArray(keyVal)) {
      res[keyName] = keyVal.map((item: any) => (item?.pubkey ? item.pubkey.toBase58() : String(item)));
    }
  }
  return res;
}

/**
 * Decode a single instruction given its programId, accounts, and data.
 */
function decodeInstruction(
  instruction: TransactionInstruction,
  instructionIndex: number,
  mintDecimals?: MintDecimalsMap,
): DecodedInstruction {
  const programIdStr = instruction.programId.toBase58();
  const accounts = instruction.keys.map((k) => ({
    pubkey: k.pubkey.toBase58(),
    isSigner: k.isSigner,
    isWritable: k.isWritable,
  }));
  const rawBase64Data = instruction.data.toString("base64");

  // System Program decoding
  if (programIdStr === PROGRAM_IDS.SystemProgram) {
    try {
      const type = SystemInstruction.decodeInstructionType(instruction);
      let decoded: unknown = { type };
      if (type === "Transfer") {
        const lamports = Number(instruction.data.readBigInt64LE(4));
        decoded = { type, lamports };
      }
      return {
        programId: programIdStr,
        programName: "SystemProgram",
        isUnsupported: false,
        accounts,
        data: decoded,
        instructionIndex,
        rawBase64Data,
      };
    } catch (e: any) {
      return {
        programId: programIdStr,
        programName: "SystemProgram",
        isUnsupported: true,
        accounts,
        data: instruction.data,
        instructionIndex,
        rawBase64Data,
        unsupportedReason: `Failed to decode SystemProgram instruction: ${e?.message ?? "unknown error"}`,
      };
    }
  }

  // SPL Token decoding (legacy token program)
  if (programIdStr === PROGRAM_IDS.TokenProgram) {
    try {
      const decoded = decodeSplTokenInstruction(instruction, TOKEN_PROGRAM_ID);
      const instructionTypeNumber = decoded.data.instruction;
      const typeName = TokenInstruction[instructionTypeNumber] ?? `Unknown_${instructionTypeNumber}`;

      let amount: number | undefined;
      let rawTokenAmountStr: string | undefined;
      let formattedTokenAmount: string | null = null;
      let isFormattedWithDecimals = false;
      let resolvedDecimals: number | undefined = undefined;

      if ("amount" in decoded.data) {
        const rawBig = BigInt(decoded.data.amount.toString());
        rawTokenAmountStr = rawBig.toString();
        amount = Number(rawBig);

        // Find relevant mint account from instruction keys if available
        let mintPubkeyStr: string | undefined;
        if ("mint" in decoded.keys && (decoded.keys as any).mint?.pubkey) {
          mintPubkeyStr = (decoded.keys as any).mint.pubkey.toBase58();
        }

        // If instruction is TransferChecked, it explicitly carries decimals in its data
        if ("decimals" in decoded.data && typeof decoded.data.decimals === "number") {
          resolvedDecimals = decoded.data.decimals;
        } else if (mintPubkeyStr && mintDecimals && mintPubkeyStr in mintDecimals) {
          resolvedDecimals = mintDecimals[mintPubkeyStr];
        }

        const formatted = formatTokenAmount(rawBig, resolvedDecimals);
        formattedTokenAmount = formatted.formattedAmount;
        isFormattedWithDecimals = formatted.isFormattedWithDecimals;
      }

      // Format authorityType for SetAuthority if present
      let authorityTypeName: string | undefined;
      if ("authorityType" in decoded.data && typeof decoded.data.authorityType === "number") {
        authorityTypeName = AuthorityType[decoded.data.authorityType] ?? `Unknown_${decoded.data.authorityType}`;
      }

      return {
        programId: programIdStr,
        programName: "TokenProgram",
        isUnsupported: false,
        accounts,
        data: {
          ...decoded.data,
          type: typeName,
          ...(amount !== undefined ? { amount } : {}),
          ...(rawTokenAmountStr !== undefined ? { rawTokenAmount: rawTokenAmountStr } : {}),
          ...(formattedTokenAmount !== null ? { formattedTokenAmount } : {}),
          ...(isFormattedWithDecimals ? { isFormattedWithDecimals, decimals: resolvedDecimals } : {}),
          ...(authorityTypeName !== undefined ? { authorityTypeName } : {}),
          parsedKeys: serializeDecodedKeys(decoded.keys),
        },
        instructionIndex,
        rawBase64Data,
      };
    } catch (e: any) {
      return {
        programId: programIdStr,
        programName: "TokenProgram",
        isUnsupported: true,
        accounts,
        data: instruction.data,
        instructionIndex,
        rawBase64Data,
        unsupportedReason: `Failed to decode TokenProgram instruction: ${e?.message ?? "unsupported instruction layout"}`,
      };
    }
  }

  // Token-2022 decoding
  if (programIdStr === PROGRAM_IDS.Token2022Program) {
    try {
      const decoded = decodeSplTokenInstruction(instruction, TOKEN_2022_PROGRAM_ID);
      const instructionTypeNumber = decoded.data.instruction;
      const typeName = TokenInstruction[instructionTypeNumber] ?? `Unknown_${instructionTypeNumber}`;

      let amount: number | undefined;
      let rawTokenAmountStr: string | undefined;
      let formattedTokenAmount: string | null = null;
      let isFormattedWithDecimals = false;
      let resolvedDecimals: number | undefined = undefined;

      if ("amount" in decoded.data) {
        const rawBig = BigInt(decoded.data.amount.toString());
        rawTokenAmountStr = rawBig.toString();
        amount = Number(rawBig);

        let mintPubkeyStr: string | undefined;
        if ("mint" in decoded.keys && (decoded.keys as any).mint?.pubkey) {
          mintPubkeyStr = (decoded.keys as any).mint.pubkey.toBase58();
        }

        if ("decimals" in decoded.data && typeof decoded.data.decimals === "number") {
          resolvedDecimals = decoded.data.decimals;
        } else if (mintPubkeyStr && mintDecimals && mintPubkeyStr in mintDecimals) {
          resolvedDecimals = mintDecimals[mintPubkeyStr];
        }

        const formatted = formatTokenAmount(rawBig, resolvedDecimals);
        formattedTokenAmount = formatted.formattedAmount;
        isFormattedWithDecimals = formatted.isFormattedWithDecimals;
      }

      let authorityTypeName: string | undefined;
      if ("authorityType" in decoded.data && typeof decoded.data.authorityType === "number") {
        authorityTypeName = AuthorityType[decoded.data.authorityType] ?? `Unknown_${decoded.data.authorityType}`;
      }

      return {
        programId: programIdStr,
        programName: "Token2022Program",
        isUnsupported: false,
        accounts,
        data: {
          ...decoded.data,
          type: typeName,
          ...(amount !== undefined ? { amount } : {}),
          ...(rawTokenAmountStr !== undefined ? { rawTokenAmount: rawTokenAmountStr } : {}),
          ...(formattedTokenAmount !== null ? { formattedTokenAmount } : {}),
          ...(isFormattedWithDecimals ? { isFormattedWithDecimals, decimals: resolvedDecimals } : {}),
          ...(authorityTypeName !== undefined ? { authorityTypeName } : {}),
          parsedKeys: serializeDecodedKeys(decoded.keys),
        },
        instructionIndex,
        rawBase64Data,
      };
    } catch (e: any) {
      // Differentiate unsupported Token-2022 extension instructions from corrupted instructions
      const isExtension = instruction.data.length > 0 && instruction.data[0] >= 20;
      return {
        programId: programIdStr,
        programName: "Token2022Program",
        isUnsupported: true,
        accounts,
        data: instruction.data,
        instructionIndex,
        rawBase64Data,
        unsupportedReason: isExtension
          ? `Unsupported Token-2022 extension instruction (discriminator: ${instruction.data[0]}). Raw data preserved.`
          : `Failed to decode Token2022Program instruction: ${e?.message ?? "unsupported instruction layout"}`,
      };
    }
  }

  // Unknown / unsupported program
  return {
    programId: programIdStr,
    programName: "Unknown",
    isUnsupported: true,
    accounts,
    data: instruction.data,
    instructionIndex,
    rawBase64Data,
    unsupportedReason: `Program ${programIdStr} is unsupported or unverified`,
  };
}

/**
 * Options for decodeTransaction.
 */
export interface DecodeTransactionOptions {
  connectionOrLookupAccounts?: Connection | AddressLookupTableAccount[];
  mintDecimals?: MintDecimalsMap;
}

/**
 * Main decoder entry point.
 * Accepts a base64-encoded unsigned or signed transaction (legacy or v0).
 * For v0 transactions, a connection or preloaded AddressLookupTableAccount[] can be supplied
 * to resolve address lookup tables.
 * Known mint decimals can also be provided to format token amounts without network roundtrips.
 */
export async function decodeTransaction(
  base64Tx: string,
  connectionOrLookupAccountsOrOptions?: Connection | AddressLookupTableAccount[] | DecodeTransactionOptions,
): Promise<DecodedTransaction> {
  if (typeof base64Tx !== "string" || !base64Tx.trim()) {
    throw new Error("Invalid transaction payload: expected non-empty base64 string");
  }

  const raw = Buffer.from(base64Tx.trim(), "base64");
  if (raw.length === 0) {
    throw new Error("Invalid transaction payload: decoded buffer is empty");
  }

  let connectionOrLookupAccounts: Connection | AddressLookupTableAccount[] | undefined = undefined;
  let mintDecimals: MintDecimalsMap | undefined = undefined;

  if (connectionOrLookupAccountsOrOptions) {
    if (
      "getAddressLookupTable" in connectionOrLookupAccountsOrOptions ||
      Array.isArray(connectionOrLookupAccountsOrOptions)
    ) {
      connectionOrLookupAccounts = connectionOrLookupAccountsOrOptions;
    } else {
      const opts = connectionOrLookupAccountsOrOptions as DecodeTransactionOptions;
      connectionOrLookupAccounts = opts.connectionOrLookupAccounts;
      mintDecimals = opts.mintDecimals;
    }
  }

  // 1. Try legacy transaction first
  let isLegacy = false;
  let legacyTx: Tx | null = null;
  try {
    legacyTx = Tx.from(raw);
    isLegacy = true;
  } catch (err: any) {
    isLegacy = false;
  }

  if (isLegacy && legacyTx) {
    const message = legacyTx.compileMessage();
    const decodedInstructions = legacyTx.instructions.map((ix, idx) =>
      decodeInstruction(ix, idx, mintDecimals),
    );

    const validSignatures = legacyTx.signatures
      .filter((s) => s && s.signature !== null)
      .map((s) => (s.signature ? Buffer.from(s.signature).toString("base64") : ""))
      .filter(Boolean);

    return {
      version: "legacy",
      signatures: validSignatures,
      message: {
        accountKeys: message.accountKeys.map((k) => k.toBase58()),
        recentBlockhash: message.recentBlockhash,
        instructionCount: message.instructions.length,
        header: message.header
          ? {
              numRequiredSignatures: message.header.numRequiredSignatures,
              numReadonlySignedAccounts: message.header.numReadonlySignedAccounts,
              numReadonlyUnsignedAccounts: message.header.numReadonlyUnsignedAccounts,
            }
          : undefined,
      },
      instructions: decodedInstructions,
    };
  }

  // 2. VersionedTransaction handling (v0)
  let vtx: VTx;
  try {
    vtx = VTx.deserialize(raw);
  } catch (vtxErr: any) {
    throw new Error(`Failed to deserialize transaction: ${vtxErr?.message ?? "malformed transaction payload"}`);
  }

  const messageV0 = vtx.message as any;
  if (typeof messageV0?.version !== "number" && vtx.version !== 0) {
    throw new Error(`Unsupported transaction version: ${vtx.version}`);
  }

  const warnings: string[] = [];
  const unresolvedLookupTables: UnresolvedLookupTable[] = [];

  // Resolve Address Lookup Tables
  let lookupTableAccounts: AddressLookupTableAccount[] = [];
  const lookups: any[] = messageV0.addressTableLookups ?? [];

  if (lookups.length > 0) {
    if (Array.isArray(connectionOrLookupAccounts)) {
      lookupTableAccounts = connectionOrLookupAccounts;
    } else if (connectionOrLookupAccounts && "getAddressLookupTable" in connectionOrLookupAccounts) {
      const conn = connectionOrLookupAccounts;
      for (const lookup of lookups) {
        const tableKeyStr = lookup.accountKey.toBase58();
        try {
          const resp = await conn.getAddressLookupTable(lookup.accountKey);
          if (resp && resp.value) {
            lookupTableAccounts.push(resp.value);
          } else {
            unresolvedLookupTables.push({
              lookupTableKey: tableKeyStr,
              reason: "table_not_found",
              details: `Address lookup table account ${tableKeyStr} not found on RPC`,
            });
          }
        } catch (fetchErr: any) {
          unresolvedLookupTables.push({
            lookupTableKey: tableKeyStr,
            reason: "fetch_failed",
            details: fetchErr?.message ?? "RPC lookup failed",
          });
        }
      }
    } else {
      for (const lookup of lookups) {
        unresolvedLookupTables.push({
          lookupTableKey: lookup.accountKey.toBase58(),
          reason: "no_connection",
          details: "No RPC connection or lookup table accounts provided to resolve table",
        });
      }
    }
  }

  // Construct complete account list:
  // 1. Static account keys
  // 2. Loaded writable addresses
  // 3. Loaded readonly addresses
  const staticKeys: PublicKey[] = messageV0.staticAccountKeys ?? [];
  const loadedWritable: PublicKey[] = [];
  const loadedReadonly: PublicKey[] = [];

  for (const tableLookup of lookups) {
    const tableKeyStr = tableLookup.accountKey.toBase58();
    const tableAccount = lookupTableAccounts.find((acc) => acc.key.equals(tableLookup.accountKey));
    if (!tableAccount) {
      if (!unresolvedLookupTables.some((u) => u.lookupTableKey === tableKeyStr)) {
        unresolvedLookupTables.push({
          lookupTableKey: tableKeyStr,
          reason: "table_not_found",
          details: `Lookup table account ${tableKeyStr} missing from supplied tables`,
        });
      }
      continue;
    }

    const tableAddresses: PublicKey[] = tableAccount.state?.addresses ?? [];

    for (const wIdx of tableLookup.writableIndexes) {
      if (wIdx < tableAddresses.length) {
        loadedWritable.push(tableAddresses[wIdx]);
      } else {
        unresolvedLookupTables.push({
          lookupTableKey: tableKeyStr,
          reason: "index_out_of_bounds",
          details: `Writable index ${wIdx} exceeds lookup table length (${tableAddresses.length})`,
        });
      }
    }

    for (const rIdx of tableLookup.readonlyIndexes) {
      if (rIdx < tableAddresses.length) {
        loadedReadonly.push(tableAddresses[rIdx]);
      } else {
        unresolvedLookupTables.push({
          lookupTableKey: tableKeyStr,
          reason: "index_out_of_bounds",
          details: `Readonly index ${rIdx} exceeds lookup table length (${tableAddresses.length})`,
        });
      }
    }
  }

  const allAccountKeys: PublicKey[] = [...staticKeys, ...loadedWritable, ...loadedReadonly];

  if (unresolvedLookupTables.length > 0) {
    warnings.push(
      `Transaction references ${lookups.length} Address Lookup Table(s), but ${unresolvedLookupTables.length} could not be fully resolved.`,
    );
  }

  // Resolve compiled instructions against the full account list
  const compiledInstructions: any[] = messageV0.compiledInstructions ?? [];
  const decodedInstructions: DecodedInstruction[] = [];

  compiledInstructions.forEach((ix, ixIndex) => {
    const programId = allAccountKeys[ix.programIdIndex];
    if (!programId) {
      decodedInstructions.push({
        programId: "Unknown_Invalid_Program_Index",
        programName: "Unknown",
        isUnsupported: true,
        accounts: [],
        data: Buffer.from(ix.data),
        instructionIndex: ixIndex,
        rawBase64Data: Buffer.from(ix.data).toString("base64"),
        unsupportedReason: `Program ID index ${ix.programIdIndex} out of bounds (total accounts: ${allAccountKeys.length})`,
      });
      warnings.push(`Instruction ${ixIndex}: program ID index ${ix.programIdIndex} out of bounds.`);
      return;
    }

    let hasInvalidAccountIndex = false;
    const keys: { pubkey: string; isSigner: boolean; isWritable: boolean }[] = [];

    for (const accountIdx of ix.accountKeyIndexes) {
      const pubkey = allAccountKeys[accountIdx];
      if (!pubkey) {
        hasInvalidAccountIndex = true;
        warnings.push(`Instruction ${ixIndex}: account index ${accountIdx} out of bounds.`);
        continue;
      }

      let isSigner = false;
      let isWritable = false;
      try {
        isSigner = typeof messageV0.isAccountSigner === "function" ? messageV0.isAccountSigner(accountIdx) : false;
        isWritable = typeof messageV0.isAccountWritable === "function" ? messageV0.isAccountWritable(accountIdx) : false;
      } catch (_) {
        const numSigners = messageV0.header?.numRequiredSignatures ?? 0;
        isSigner = accountIdx < numSigners;
        isWritable = accountIdx < staticKeys.length ? accountIdx < numSigners : accountIdx < staticKeys.length + loadedWritable.length;
      }

      keys.push({
        pubkey: pubkey.toBase58(),
        isSigner,
        isWritable,
      });
    }

    if (hasInvalidAccountIndex) {
      decodedInstructions.push({
        programId: programId.toBase58(),
        programName: "Unknown",
        isUnsupported: true,
        accounts: keys,
        data: Buffer.from(ix.data),
        instructionIndex: ixIndex,
        rawBase64Data: Buffer.from(ix.data).toString("base64"),
        unsupportedReason: `Instruction contains out-of-bounds account indexes. Partially decoded with ${keys.length} accounts.`,
      });
      return;
    }

    const txInstruction = new TransactionInstruction({
      programId,
      keys: keys.map((k) => ({
        pubkey: allAccountKeys.find((a) => a.toBase58() === k.pubkey)!,
        isSigner: k.isSigner,
        isWritable: k.isWritable,
      })),
      data: Buffer.from(ix.data),
    });

    decodedInstructions.push(decodeInstruction(txInstruction, ixIndex, mintDecimals));
  });

  // Collect valid (non-zero) signatures
  const validSignatures = (vtx.signatures ?? [])
    .filter((sig) => sig && sig.some((byte: number) => byte !== 0))
    .map((sig) => Buffer.from(sig).toString("base64"));

  return {
    version: "v0",
    signatures: validSignatures,
    message: {
      accountKeys: allAccountKeys.map((k) => k.toBase58()),
      recentBlockhash: messageV0.recentBlockhash ?? "",
      instructionCount: compiledInstructions.length,
      header: messageV0.header
        ? {
            numRequiredSignatures: messageV0.header.numRequiredSignatures,
            numReadonlySignedAccounts: messageV0.header.numReadonlySignedAccounts,
            numReadonlyUnsignedAccounts: messageV0.header.numReadonlyUnsignedAccounts,
          }
        : undefined,
    },
    instructions: decodedInstructions,
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(unresolvedLookupTables.length > 0 ? { unresolvedLookupTables } : {}),
  };
}

export default decodeTransaction;
