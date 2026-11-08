// src/components/inspector/types.ts
/**
 * Types for Interactive CPI Call-Graph and Account State Diff Matrix.
 */

export interface CpiCallNode {
  id: string;
  depth: number;
  callerProgramId: string;
  callerProgramName?: string;
  calleeProgramId: string;
  calleeProgramName?: string;
  instructionName: string;
  discriminator?: string;
  isSignerEscalation: boolean;
  isWritableEscalation: boolean;
  accounts: Array<{
    pubkey: string;
    isSigner: boolean;
    isWritable: boolean;
  }>;
  triggeredRules: string[]; // e.g. ["VS-06", "VS-02"]
  children: CpiCallNode[];
  status?: "success" | "failed" | "unknown";
  rawData?: string;
}

export type StateDiffProvenance =
  | "Verified via RPC Snapshot"
  | "Inferred from Static Instruction";

export interface AccountStateDiff {
  pubkey: string;
  label?: string;
  isWritable: boolean;
  isSigner: boolean;
  preLamports: number;
  postLamports: number;
  lamportsDelta: number;
  preOwner: string;
  postOwner: string;
  isOwnerMutated: boolean;
  preDataLen: number;
  postDataLen: number;
  dataLenDelta: number;
  provenance: StateDiffProvenance;
  notes?: string;
}
