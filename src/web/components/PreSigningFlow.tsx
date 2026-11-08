// src/web/components/PreSigningFlow.tsx
import React, { useState, useEffect, useRef } from "react";
import { Transaction as LegacyTx, VersionedTransaction as VTx } from "@solana/web3.js";
import { decodeTransaction, DecodedTransaction } from "../../solana/transactionDecoder";
import { computeRiskScore, TransactionRiskAssessment } from "../../solana/transactionRiskScore";
import {
  createDeterministicFallback,
  type GeminiAnalysisInput,
  type GeminiExplanation,
  type Explanation,
} from "../../gemini/explanation";
import { sha256 } from "../utils/crypto";
import CpiCallTree from "./inspector/CpiCallTree";
import AccountDiffMatrix from "./inspector/AccountDiffMatrix";
import AuditReceiptExport from "./AuditReceiptExport";
import type { SimulationResult } from "../../solana/simulateTransaction";

/**
 * Explicit state machine for the pre-signing firewall workflow.
 */
export type PreSigningState =
  | "idle"
  | "decoding"
  | "simulating"
  | "analyzing"
  | "ready"
  | "rejected"
  | "signing"
  | "signed"
  | "error";

/**
 * Standard Solana Wallet Provider interface.
 */
export interface WalletProvider {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string; equals?: (other: any) => boolean } | null;
  signTransaction<T extends LegacyTx | VTx>(transaction: T): Promise<T>;
  request?: (args: { method: string; params?: any }) => Promise<any>;
}

export interface ExtractedSignersInfo {
  requiredSigners: string[];
  feePayer: string | null;
  numRequiredSignatures: number;
  version: "legacy" | "v0";
}

/**
 * Extracts required signer public keys and expected fee payer from a Solana transaction.
 * Supports legacy transactions, versioned transactions (v0), decoded transactions, or base64 wire strings.
 */
export function extractRequiredSigners(
  tx: LegacyTx | VTx | DecodedTransaction | string,
): ExtractedSignersInfo {
  if (typeof tx === "string") {
    const raw = Buffer.from(tx.trim(), "base64");
    try {
      const legacy = LegacyTx.from(raw);
      return extractRequiredSigners(legacy);
    } catch (_) {
      try {
        const vtx = VTx.deserialize(raw);
        return extractRequiredSigners(vtx);
      } catch (_) {
        return {
          requiredSigners: [],
          feePayer: null,
          numRequiredSignatures: 0,
          version: "legacy",
        };
      }
    }
  }

  if (tx instanceof LegacyTx) {
    try {
      const msg = tx.compileMessage();
      const numReq = msg.header.numRequiredSignatures;
      const requiredSigners = msg.accountKeys.slice(0, numReq).map((k) => k.toBase58());
      const feePayer = tx.feePayer ? tx.feePayer.toBase58() : (requiredSigners[0] ?? null);
      return {
        requiredSigners,
        feePayer,
        numRequiredSignatures: numReq,
        version: "legacy",
      };
    } catch (_) {
      const signers: string[] = [];
      if (tx.feePayer) signers.push(tx.feePayer.toBase58());
      for (const sig of tx.signatures) {
        if (sig.publicKey && !signers.includes(sig.publicKey.toBase58())) {
          signers.push(sig.publicKey.toBase58());
        }
      }
      return {
        requiredSigners: signers,
        feePayer: tx.feePayer?.toBase58() ?? (signers[0] ?? null),
        numRequiredSignatures: signers.length,
        version: "legacy",
      };
    }
  }

  if (tx instanceof VTx) {
    const numReq = tx.message.header.numRequiredSignatures;
    const requiredSigners = tx.message.staticAccountKeys.slice(0, numReq).map((k) => k.toBase58());
    const feePayer = requiredSigners.length > 0 ? requiredSigners[0] : null;
    return {
      requiredSigners,
      feePayer,
      numRequiredSignatures: numReq,
      version: "v0",
    };
  }

  // DecodedTransaction
  if ("message" in tx && tx.message) {
    const numReq = tx.message.header?.numRequiredSignatures ?? 0;
    const requiredSigners = tx.message.accountKeys.slice(0, numReq);
    const feePayer = requiredSigners.length > 0 ? requiredSigners[0] : null;
    return {
      requiredSigners,
      feePayer,
      numRequiredSignatures: numReq,
      version: tx.version ?? "legacy",
    };
  }

  return {
    requiredSigners: [],
    feePayer: null,
    numRequiredSignatures: 0,
    version: "legacy",
  };
}

/**
 * Props for the PreSigningFlow component.
 */
export interface PreSigningFlowProps {
  base64Tx: string;
  onSigned?: (signedBase64: string) => void;
  walletProvider?: WalletProvider;
  simulation?: SimulationResult | null;
  simulateOutage?: boolean;
}

/**
 * PreSigningFlow — Secure Pre-Signing Firewall Component.
 *
 * Enforces an explicit state machine:
 *   idle -> decoding -> analyzing -> ready -> (rejected | signing -> signed | error)
 *
 * Integrated Pipeline (Phase 16.1):
 * 1. Decode transaction into instructions, programs, and accounts.
 * 2. Deterministic STRS scoring (VS-01 to VS-08) — authoritative and unmodifiable by LLM.
 * 3. Semantic RAG retrieval tailored to decoded transaction and STRS findings.
 * 4. Zod-guarded Google Gemini AI explanation with automatic offline deterministic fallback.
 * 5. Exact SHA-256 wire fingerprint binding & TOCTOU pre-signing tampering protection.
 * 6. Visual CPI call tree & pre/post account state diff matrix.
 * 7. Verifiable security audit receipt export.
 * 8. Rejection safety & zero auto-broadcast.
 */
export default function PreSigningFlow({
  base64Tx,
  onSigned,
  walletProvider,
  simulation,
  simulateOutage = false,
}: PreSigningFlowProps) {
  const [state, setState] = useState<PreSigningState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isTampered, setIsTampered] = useState(false);
  const [decodedTx, setDecodedTx] = useState<DecodedTransaction | null>(null);
  const [riskAssessment, setRiskAssessment] = useState<TransactionRiskAssessment | null>(null);
  const [geminiExplanation, setGeminiExplanation] = useState<GeminiExplanation | null>(null);
  const [legacyExplanation, setLegacyExplanation] = useState<Explanation | null>(null);
  const [findingEvidence, setFindingEvidence] = useState<any[]>([]);
  const [ragSummary, setRagSummary] = useState<string>("");
  const [isFallback, setIsFallback] = useState<boolean>(false);
  const [inspectedHash, setInspectedHash] = useState<string | null>(null);

  // Prevent duplicate concurrent signing requests
  const isSigningRef = useRef(false);

  // Active wallet provider
  const getWallet = (): WalletProvider | undefined => {
    if (walletProvider) return walletProvider;
    if (typeof window !== "undefined" && (window as any).solana) {
      return (window as any).solana as WalletProvider;
    }
    return undefined;
  };

  useEffect(() => {
    let isCancelled = false;

    async function inspect() {
      if (!base64Tx || !base64Tx.trim()) {
        setState("idle");
        return;
      }

      setError(null);
      setState("decoding");

      try {
        const rawBytes = Buffer.from(base64Tx.trim(), "base64");
        if (rawBytes.length === 0) {
          throw new Error("Transaction payload is empty");
        }

        // 1. Exact inspected hash binding
        const hash = await sha256(rawBytes);
        if (isCancelled) return;
        setInspectedHash(hash);

        // 2. Decode transaction
        const decoded = await decodeTransaction(base64Tx);
        if (isCancelled) return;
        setDecodedTx(decoded);

        // 3. Analyzing & STRS risk scoring (authoritative & deterministic)
        setState("analyzing");
        const assessment = computeRiskScore(decoded, undefined, simulation || undefined);
        if (isCancelled) return;
        setRiskAssessment(assessment);

        // 4. Request Semantic RAG + Gemini Explanation from backend service
        let explResult: GeminiExplanation;
        let evidenceResult: any[] = [];
        let summaryResult = "";
        let fallbackActive = false;

        try {
          const payload: any = {
            base64Tx: base64Tx.trim(),
            simulateOutage: Boolean(simulateOutage),
          };
          if (simulation) {
            payload.simulation = {
              status: simulation.status,
              error: simulation.errorMessage || (simulation.error ? String(simulation.error) : undefined),
              logs: simulation.logs,
              limitations: [],
            };
          }

          const res = await fetch("/api/gemini/explain", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });

          if (res.ok) {
            const data = await res.json();
            if (data.explanation) {
              explResult = data.explanation;
              evidenceResult = Array.isArray(data.findingEvidence) ? data.findingEvidence : [];
              summaryResult = data.ragSummary || "";
              fallbackActive = Boolean(data.isFallback);
            } else {
              throw new Error("Invalid response format from explanation API");
            }
          } else {
            const errData = await res.json().catch(() => ({}));
            throw new Error(errData.error || `HTTP ${res.status} from explanation API`);
          }
        } catch (fetchErr: any) {
          // Graceful deterministic fallback: if Gemini API or network fails, generate fallback locally!
          fallbackActive = true;
          const analysisInput: GeminiAnalysisInput = {
            transactionHash: hash,
            network: "devnet",
            riskScore: assessment.score,
            riskLevel: assessment.riskLevel,
            confidence: assessment.confidence,
            findings: assessment.breakdown.map((f) => ({
              ruleId: f.id,
              severity: f.severity,
              confidence: f.confidence,
              explanation: f.explanation,
              instructionIndex: f.instructionIndex,
              affectedAccounts: f.affectedAccounts,
              evidence: f.evidence,
            })),
            instructions: decoded.instructions.map((ix, idx) => ({
              index: idx,
              programId: ix.programId,
              programName: ix.programName,
              instructionName: (ix.data as any)?.type,
              accounts: ix.accounts.map((a) => a.pubkey),
              decodedData: typeof ix.data === "object" ? (ix.data as any) : undefined,
            })),
            simulation: {
              status: simulation?.status || "not_simulated",
              error: simulation?.errorMessage || (simulation?.error ? String(simulation.error) : undefined),
              logs: simulation?.logs,
              limitations: [],
            },
            retrievedEvidence: [],
          };

          explResult = createDeterministicFallback(
            analysisInput,
            `Deterministic fallback: ${fetchErr?.message || "Gemini service unreachable"}`,
          );
          summaryResult = "Offline deterministic evaluation active. RAG knowledge service unreachable.";
        }

        if (isCancelled) return;
        setGeminiExplanation(explResult);
        setFindingEvidence(evidenceResult);
        setRagSummary(summaryResult);
        setIsFallback(fallbackActive);

        // Maintain backward-compatible legacy explanation structure for exports/tests
        setLegacyExplanation({
          summary: explResult.transactionSummary,
          findings: assessment.breakdown.map((f) => ({
            id: f.id,
            description: f.description,
            severity: f.severity,
            confidence: f.confidence,
            evidenceIds: [],
          })),
          evidence: evidenceResult.flatMap((g) =>
            (g.documents || []).map((d: any) => ({
              source: d.title,
              uri: d.sourceUrl || "https://solana.com",
              snippet: d.excerpt,
            })),
          ),
          uncertainty: explResult.limitations?.join(" · ") || "Evaluated by deterministic STRS engine.",
          limitations: "Evidence retrieved from Solana security corpus.",
        });

        setState("ready");
      } catch (err: any) {
        if (isCancelled) return;
        setError(err?.message ?? "Failed to inspect transaction");
        setState("error");
      }
    }

    inspect();

    return () => {
      isCancelled = true;
    };
  }, [base64Tx, simulateOutage, simulation]);

  // Handler for Reject — strictly transitions to "rejected" without touching wallet
  const handleReject = () => {
    if (state === "signing" || state === "signed") return;
    setState("rejected");
  };

  // Handler for Approve — verifies cryptographic transaction binding, required signers, and signs
  const handleApprove = async () => {
    if (state !== "ready" || isSigningRef.current) {
      return;
    }

    if (!inspectedHash) {
      setError("Cannot sign: inspected transaction hash is missing");
      setState("error");
      return;
    }

    isSigningRef.current = true;
    setState("signing");
    setError(null);

    try {
      const raw = Buffer.from(base64Tx.trim(), "base64");
      let txObj: LegacyTx | VTx;

      // Try deserializing as legacy or v0
      try {
        txObj = LegacyTx.from(raw);
      } catch (_) {
        try {
          txObj = VTx.deserialize(raw);
        } catch (err: any) {
          throw new Error(`Failed to deserialize transaction: ${err?.message || "Invalid payload"}`);
        }
      }

      // 1. Determine actual required signer keys and fee payer
      const signersInfo = extractRequiredSigners(txObj);
      if (signersInfo.numRequiredSignatures === 0 || signersInfo.requiredSigners.length === 0) {
        throw new Error("Transaction specifies no required signers. Signing was blocked for safety.");
      }

      // 2. Check wallet availability and public key
      const wallet = getWallet();
      if (!wallet) {
        throw new Error("No Solana wallet provider detected");
      }
      if (!wallet.publicKey) {
        throw new Error("Connected wallet has no public key available");
      }

      const connectedWalletPubkey =
        typeof wallet.publicKey.toBase58 === "function"
          ? wallet.publicKey.toBase58()
          : String(wallet.publicKey);

      // 3. Verify connected wallet matches one of the required signers (do not assume first signer)
      if (!signersInfo.requiredSigners.includes(connectedWalletPubkey)) {
        const payerNotice = signersInfo.feePayer ? ` Expected fee payer: ${signersInfo.feePayer}.` : "";
        throw new Error(
          `Wallet Signer Mismatch: Connected wallet (${connectedWalletPubkey}) is not a required signer. Required signers: [${signersInfo.requiredSigners.join(", ")}].${payerNotice} Transaction signing was blocked for safety.`,
        );
      }

      // 4. Cryptographic Transaction Binding & TOCTOU Pre-Signing Equality Checks:
      // Check A: Wire bytes hash comparison
      const currentRawHash = await sha256(raw);
      if (currentRawHash !== inspectedHash) {
        setIsTampered(true);
        throw new Error(
          `Payload Tampering Detected! Cryptographic transaction binding mismatch: Inspected hash (${inspectedHash}) does not match current raw wire hash (${currentRawHash}). Transaction was modified after inspection.`,
        );
      }

      // Check B: Re-serialize the transaction object and verify its SHA-256 matches inspectedHash bit-for-bit
      let reSerialized: Uint8Array;
      if (txObj instanceof LegacyTx) {
        reSerialized = txObj.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        });
      } else {
        reSerialized = txObj.serialize();
      }

      const preSignHash = await sha256(reSerialized);
      if (preSignHash !== inspectedHash) {
        setIsTampered(true);
        throw new Error(
          `Payload Tampering Detected! Cryptographic transaction binding mismatch: Inspected hash (${inspectedHash}) does not match pre-sign hash (${preSignHash}). Transaction was modified after inspection.`,
        );
      }

      // Check C: Verify relevant transaction message properties against inspected decodedTx
      if (decodedTx) {
        let blockhash: string;
        let accountKeysLength: number;
        let instructionCount: number;
        let numReqSignatures: number;

        if (txObj instanceof LegacyTx) {
          const msg = txObj.compileMessage();
          blockhash = msg.recentBlockhash;
          accountKeysLength = msg.accountKeys.length;
          instructionCount = msg.instructions.length;
          numReqSignatures = msg.header.numRequiredSignatures;
        } else {
          blockhash = txObj.message.recentBlockhash;
          accountKeysLength = txObj.message.staticAccountKeys.length;
          instructionCount = txObj.message.compiledInstructions.length;
          numReqSignatures = txObj.message.header.numRequiredSignatures;
        }

        const inspectedInstructionCount =
          decodedTx.instructions?.length ?? decodedTx.message.instructionCount;

        if (
          blockhash !== decodedTx.message.recentBlockhash ||
          accountKeysLength !== decodedTx.message.accountKeys.length ||
          instructionCount !== inspectedInstructionCount ||
          (decodedTx.message.header && numReqSignatures !== decodedTx.message.header.numRequiredSignatures)
        ) {
          setIsTampered(true);
          throw new Error(
            "Payload Tampering Detected! Transaction message properties were altered after inspection.",
          );
        }
      }

      // 5. Request signature from wallet (single call, explicit user initiation)
      const signedTx = await wallet.signTransaction(txObj);

      // 6. Verify signed transaction message integrity (wallet must not rewrite instructions)
      if (signedTx instanceof LegacyTx && txObj instanceof LegacyTx) {
        if (signedTx.compileMessage().instructions.length !== txObj.compileMessage().instructions.length) {
          throw new Error("Signed transaction altered instruction count during wallet signing");
        }
      } else if (signedTx instanceof VTx && txObj instanceof VTx) {
        if (signedTx.message.compiledInstructions.length !== txObj.message.compiledInstructions.length) {
          throw new Error("Signed versioned transaction altered instruction count during wallet signing");
        }
      }

      // 7. Serialize signed transaction
      let signedBytes: Uint8Array;
      if (signedTx instanceof LegacyTx) {
        signedBytes = signedTx.serialize({
          requireAllSignatures: false,
          verifySignatures: false,
        });
      } else {
        signedBytes = signedTx.serialize();
      }

      const signedBase64 = Buffer.from(signedBytes).toString("base64");
      setState("signed");

      // Hand off to callback without auto-broadcasting
      if (onSigned) {
        onSigned(signedBase64);
      }
    } catch (err: any) {
      setError(err?.message ?? "Transaction signing failed");
      setState("error");
    } finally {
      isSigningRef.current = false;
    }
  };

  // Render loading state views
  if (state === "decoding" || state === "simulating" || state === "analyzing") {
    return (
      <div className="p-4 border rounded bg-slate-50" data-testid="presigning-loading">
        <p className="text-sm text-slate-700 font-medium">
          {state === "decoding" && "Decoding transaction payload…"}
          {state === "simulating" && "Simulating execution on chain…"}
          {state === "analyzing" && "Analyzing STRS risk scoring and retrieving RAG evidence…"}
        </p>
      </div>
    );
  }

  if (state === "error") {
    const isTamperingError = isTampered || error?.includes("Payload Tampering Detected");

    return (
      <div
        className={`p-4 border rounded ${
          isTamperingError
            ? "border-red-600 bg-red-50 text-red-950 shadow-md"
            : "border-red-300 bg-red-50"
        }`}
        data-testid="presigning-error"
      >
        {isTamperingError ? (
          <div data-testid="payload-tampering-alert">
            <div className="flex items-center gap-2 text-red-700 font-bold text-base mb-1">
              <span className="text-xl">🚨</span>
              <span>Payload Tampering Detected</span>
            </div>
            <p className="text-xs text-red-800 mb-2 font-medium">
              Cryptographic TOCTOU verification failed! The serialized transaction buffer immediately prior to wallet
              invocation did not match the SHA-256 digest inspected by SOLVul. Transaction signing was aborted
              immediately and the wallet API was not invoked.
            </p>
            <div className="text-xs font-mono bg-red-100 p-2 rounded border border-red-300 break-all text-red-900">
              {error}
            </div>
          </div>
        ) : (
          <>
            <h3 className="text-red-700 font-bold mb-1">Pre-Signing Firewall Error</h3>
            <p className="text-sm text-red-600">{error ?? "An unexpected error occurred"}</p>
          </>
        )}
      </div>
    );
  }

  if (state === "idle" || (!geminiExplanation && !legacyExplanation)) {
    return (
      <div className="p-4 border rounded text-slate-500" data-testid="presigning-idle">
        No transaction loaded for inspection.
      </div>
    );
  }

  const activeExplanation = geminiExplanation;

  const activeWallet = getWallet();
  const connectedPubkey = activeWallet?.publicKey
    ? typeof activeWallet.publicKey.toBase58 === "function"
      ? activeWallet.publicKey.toBase58()
      : String(activeWallet.publicKey)
    : null;

  const signersInfo = decodedTx ? extractRequiredSigners(decodedTx) : null;
  const isSignerMismatch = Boolean(
    connectedPubkey &&
      signersInfo &&
      signersInfo.requiredSigners.length > 0 &&
      !signersInfo.requiredSigners.includes(connectedPubkey),
  );
  const isMissingSigners = Boolean(
    signersInfo && signersInfo.requiredSigners.length === 0,
  );

  return (
    <div className="p-4 border rounded bg-white shadow-md max-w-2xl mx-auto" data-testid="presigning-flow">
      {/* Header with STRS Risk Level & Status Badges */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b pb-3 mb-4 gap-2">
        <h2 className="text-lg font-bold text-slate-900">Pre-Sign Security Firewall</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {riskAssessment && (
            <span
              className={`px-2.5 py-0.5 text-xs font-semibold rounded ${
                riskAssessment.riskLevel === "CRITICAL"
                  ? "bg-red-100 text-red-800 border border-red-200"
                  : riskAssessment.riskLevel === "HIGH"
                  ? "bg-orange-100 text-orange-800 border border-orange-200"
                  : riskAssessment.riskLevel === "MEDIUM"
                  ? "bg-yellow-100 text-yellow-800 border border-yellow-200"
                  : "bg-green-100 text-green-800 border border-green-200"
              }`}
              data-testid="strs-score-badge"
            >
              STRS: {riskAssessment.score}/100 ({riskAssessment.riskLevel})
            </span>
          )}

          {/* Gemini Availability Status Badge */}
          {!isFallback ? (
            <span
              className="px-2.5 py-0.5 text-xs font-semibold bg-violet-100 text-violet-800 rounded-full border border-violet-200"
              data-testid="gemini-status-badge"
            >
              ✨ Powered by Gemini ({activeExplanation?.modelUsed || "gemini-2.5-flash"})
            </span>
          ) : (
            <span
              className="px-2.5 py-0.5 text-xs font-semibold bg-slate-100 text-slate-700 rounded-full border border-slate-300"
              data-testid="gemini-status-badge"
            >
              ⚙️ Deterministic Fallback Mode
            </span>
          )}

          {/* RAG Availability Status Badge */}
          <span
            className="px-2.5 py-0.5 text-xs font-semibold bg-indigo-50 text-indigo-700 rounded-full border border-indigo-200"
            data-testid="rag-status-badge"
          >
            📚 RAG: {findingEvidence.length > 0 ? `${findingEvidence.reduce((acc, f) => acc + (f.documents?.length || 0), 0)} Sources` : "No Evidence Matched"}
          </span>
        </div>
      </div>

      {/* Wallet Signer Mismatch Warning Banner */}
      {isSignerMismatch && (
        <div
          className="mb-4 p-3 rounded-lg border border-red-300 bg-red-50 text-red-950 text-xs shadow-xs"
          data-testid="wallet-signer-mismatch-warning"
        >
          <div className="flex items-center gap-1.5 font-bold text-red-800 mb-1 text-sm">
            <span>⚠️</span>
            <span>Wallet Signer Mismatch Detected</span>
          </div>
          <p className="mb-1 text-red-900 leading-relaxed">
            Connected wallet (<code className="font-mono bg-red-100 px-1 py-0.5 rounded">{connectedPubkey}</code>) is <strong>not</strong> a required signer for this transaction.
          </p>
          <p className="text-red-800 text-[11px]">
            Required Signers: [<span className="font-mono">{signersInfo?.requiredSigners.join(", ")}</span>]
            {signersInfo?.feePayer && (
              <span> · Expected Fee Payer: <code className="font-mono">{signersInfo.feePayer}</code></span>
            )}
          </p>
          <p className="mt-1.5 font-semibold text-red-900">
            Signing will be strictly blocked to protect your funds and prevent unauthorized transactions.
          </p>
        </div>
      )}

      {/* Missing Signers Warning Banner */}
      {isMissingSigners && (
        <div
          className="mb-4 p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-950 text-xs shadow-xs"
          data-testid="missing-signers-warning"
        >
          <span className="font-bold">⚠️ Warning:</span> This transaction specifies 0 required signers in its header. Signing cannot be performed.
        </div>
      )}

      {/* Cryptographic TOCTOU Fingerprint & Decoded Message Header Counts */}
      <div
        className="mb-4 p-3.5 bg-slate-900 text-slate-100 rounded-lg border border-slate-700 shadow-xs"
        data-testid="payload-fingerprint-panel"
      >
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-bold text-indigo-300 uppercase tracking-wider">
            <span>🔒</span>
            <span>Cryptographic Wire Payload Fingerprint (SHA-256)</span>
          </div>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
            {decodedTx?.version.toUpperCase() ?? "TX"} Wire Format
          </span>
        </div>

        <div className="bg-slate-950 p-2 rounded border border-slate-800 font-mono text-xs text-emerald-400 break-all select-all">
          <span data-testid="payload-sha256-fingerprint">{inspectedHash}</span>
        </div>

        {/* Decoded Message Header Counts */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 pt-2 border-t border-slate-800 text-[11px] font-mono">
          <div className="bg-slate-800/80 p-1.5 rounded">
            <span className="text-slate-400 block text-[10px]">Req. Signatures</span>
            <span className="font-bold text-white text-xs">
              {decodedTx?.message.header?.numRequiredSignatures ?? (decodedTx?.signatures.length || 1)}
            </span>
          </div>
          <div className="bg-slate-800/80 p-1.5 rounded">
            <span className="text-slate-400 block text-[10px]">Readonly Signed</span>
            <span className="font-bold text-white text-xs">
              {decodedTx?.message.header?.numReadonlySignedAccounts ?? 0}
            </span>
          </div>
          <div className="bg-slate-800/80 p-1.5 rounded">
            <span className="text-slate-400 block text-[10px]">Readonly Unsigned</span>
            <span className="font-bold text-white text-xs">
              {decodedTx?.message.header?.numReadonlyUnsignedAccounts ?? 0}
            </span>
          </div>
          <div className="bg-slate-800/80 p-1.5 rounded">
            <span className="text-slate-400 block text-[10px]">Total Accounts</span>
            <span className="font-bold text-white text-xs">
              {decodedTx?.message.accountKeys.length ?? 0}
            </span>
          </div>
        </div>
      </div>

      {/* On-Chain Simulation Status & Safety Semantics Panel */}
      <div
        className="mb-4 p-3.5 bg-slate-50 rounded-lg border border-slate-200 shadow-xs"
        data-testid="simulation-status-panel"
      >
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 uppercase tracking-wider">
            <span>🔬</span>
            <span>On-Chain Simulation Semantics</span>
          </div>
          <div>
            {!simulation ? (
              <span
                className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-slate-100 text-slate-700 border border-slate-300"
                data-testid="simulation-status-badge"
              >
                Simulation Skipped
              </span>
            ) : simulation.status === "unavailable" ? (
              <span
                className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-amber-100 text-amber-800 border border-amber-300"
                data-testid="simulation-status-badge"
              >
                Simulation Unavailable
              </span>
            ) : simulation.status === "failed" ? (
              <span
                className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-rose-100 text-rose-800 border border-rose-300"
                data-testid="simulation-status-badge"
              >
                Simulation Failed
              </span>
            ) : simulation.status === "success_with_warnings" || !simulation.hasFullAccountDiff ? (
              <span
                className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800 border border-yellow-300"
                data-testid="simulation-status-badge"
              >
                Simulation Result Incomplete
              </span>
            ) : (
              <span
                className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300"
                data-testid="simulation-status-badge"
              >
                Simulation Succeeded
              </span>
            )}
          </div>
        </div>

        <div className="text-xs text-slate-700" data-testid="simulation-disclaimer">
          {!simulation && (
            <p className="text-slate-500 italic">
              Simulation was skipped for this transaction. Deterministic STRS static inspection was evaluated without live RPC state.
            </p>
          )}

          {simulation && simulation.status === "unavailable" && (
            <div className="text-amber-800 bg-amber-50/70 p-2.5 rounded border border-amber-200">
              <p className="font-semibold mb-0.5">Simulation Unavailable</p>
              <p className="text-[11px] text-amber-700">
                Simulation could not be executed because the RPC node is unreachable or offline. Static STRS inspection remains authoritative.
              </p>
            </div>
          )}

          {simulation && simulation.status === "failed" && (
            <div className="text-rose-900 bg-rose-50/80 p-2.5 rounded border border-rose-200">
              <p className="font-semibold mb-0.5">
                Simulation Failed: {simulation.errorMessage || (simulation.error ? String(simulation.error) : "Instruction execution failed.")}
              </p>
              <p className="text-[11px] text-rose-700">
                Note: Simulation failure does not necessarily indicate malicious intent. Common non-malicious causes include expired recent blockhashes, insufficient Devnet/mock SOL or token balances, or program condition checks.
              </p>
            </div>
          )}

          {simulation && (simulation.status === "success_with_warnings" || (!simulation.hasFullAccountDiff && simulation.status === "success")) && (
            <div className="text-yellow-900 bg-yellow-50/80 p-2.5 rounded border border-yellow-200">
              <p className="font-semibold mb-0.5">
                Simulation Result Incomplete: Partial account state diffs returned.
              </p>
              <p className="text-[11px] text-yellow-800">
                Not all account state mutations could be captured by the RPC snapshot.
              </p>
            </div>
          )}

          {simulation && simulation.status === "success" && simulation.hasFullAccountDiff && (
            <div className="text-emerald-950 bg-emerald-50/80 p-2.5 rounded border border-emerald-200">
              <p className="font-semibold mb-0.5">
                Simulation Succeeded (0 runtime errors).
              </p>
              <p className="text-[11px] text-emerald-800 font-medium">
                Critical Security Notice: Successful simulation is NOT proof of safety. A transaction may simulate successfully while executing unauthorized ownership reassignments, delegate approvals, or malicious state changes.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Deterministic STRS Findings Section */}
      {riskAssessment && riskAssessment.breakdown.length > 0 && (
        <section className="mb-4" data-testid="deterministic-findings-section">
          <h3 className="font-semibold text-sm text-slate-800 mb-2 flex items-center justify-between">
            <span>Deterministic STRS Findings ({riskAssessment.breakdown.length})</span>
            <span className="text-xs text-slate-500 font-normal">Authoritative rule-based detections</span>
          </h3>
          <ul className="space-y-1.5">
            {riskAssessment.breakdown.map((f) => (
              <li
                key={f.id}
                className="text-xs bg-slate-50 p-2.5 rounded border border-slate-200 flex flex-col"
                data-testid={`finding-${f.id}`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="font-bold text-slate-900">{f.id} — {f.description}</span>
                  <span className="text-slate-500 font-mono text-[11px]">
                    Severity {f.severity}/10 · Confidence {Math.round(f.confidence * 100)}%
                  </span>
                </div>
                <span className="text-slate-700">{f.explanation}</span>
                {f.affectedAccounts && f.affectedAccounts.length > 0 && (
                  <div className="mt-1 text-[10px] text-slate-500 font-mono truncate">
                    Accounts: {f.affectedAccounts.join(", ")}
                  </div>
                )}
                {f.suggestedAction && (
                  <div className="mt-1 text-[11px] text-amber-800 bg-amber-50 p-1 rounded font-medium">
                    Suggested Action: {f.suggestedAction}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Google Gemini AI Security Explanation Section */}
      {activeExplanation && (
        <section className="mb-4 p-3.5 bg-slate-50 border border-slate-200 rounded-lg" data-testid="gemini-explanation-section">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-sm text-slate-900 flex items-center gap-1.5">
              <span>🛡️</span> AI Security Analysis & Plain-English Explanation
            </h3>
            <span className="text-[10px] text-slate-500 uppercase font-mono tracking-wider">
              {activeExplanation.isFallback ? "Deterministic Fallback" : "Gemini Generative"}
            </span>
          </div>

          {/* Transaction Summary */}
          <div className="mb-3">
            <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-0.5">What this transaction does</h4>
            <p className="text-xs text-slate-800 font-medium leading-relaxed" data-testid="explanation-summary">
              {activeExplanation.transactionSummary}
            </p>
          </div>

          {/* Risk Explanation */}
          <div className="mb-3">
            <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider mb-0.5">Risk Analysis</h4>
            <p className="text-xs text-slate-700 leading-relaxed" data-testid="explanation-risk">
              {activeExplanation.riskExplanation}
            </p>
          </div>

          {/* Security Concerns */}
          {activeExplanation.securityConcerns && activeExplanation.securityConcerns.length > 0 && (
            <div className="mb-3 p-2.5 bg-red-50/80 border border-red-200 rounded">
              <h4 className="text-xs font-bold text-red-900 mb-1 flex items-center gap-1">
                <span>⚠️</span> Security Concerns
              </h4>
              <ul className="text-xs text-red-800 space-y-0.5 list-disc list-inside">
                {activeExplanation.securityConcerns.map((concern, idx) => (
                  <li key={idx}>{concern}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Affected Assets */}
          {activeExplanation.affectedAssets && activeExplanation.affectedAssets.length > 0 && (
            <div className="mb-3 p-2.5 bg-amber-50/80 border border-amber-200 rounded">
              <h4 className="text-xs font-bold text-amber-900 mb-1 flex items-center gap-1">
                <span>💼</span> Potentially Affected Assets & Accounts
              </h4>
              <ul className="text-xs text-amber-800 space-y-0.5 font-mono list-disc list-inside">
                {activeExplanation.affectedAssets.map((asset, idx) => (
                  <li key={idx}>{asset}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommended Actions */}
          {activeExplanation.recommendedActions && activeExplanation.recommendedActions.length > 0 && (
            <div className="mb-3 p-2.5 bg-emerald-50 border border-emerald-200 rounded">
              <h4 className="text-xs font-bold text-emerald-900 mb-1 flex items-center gap-1">
                <span>✅</span> Recommended Verification Steps Before Signing
              </h4>
              <ul className="text-xs text-emerald-800 space-y-0.5 list-disc list-inside">
                {activeExplanation.recommendedActions.map((action, idx) => (
                  <li key={idx}>{action}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Simulation Interpretation */}
          {activeExplanation.simulationInterpretation && (
            <div className="mb-2 text-xs text-slate-600 bg-white p-2 rounded border border-slate-200">
              <span className="font-semibold text-slate-700">Simulation Interpretation: </span>
              {activeExplanation.simulationInterpretation}
            </div>
          )}

          {/* Limitations */}
          {activeExplanation.limitations && activeExplanation.limitations.length > 0 && (
            <div className="pt-2 border-t border-slate-200 text-[11px] text-slate-500">
              <span className="font-semibold text-slate-600">Remaining Uncertainties: </span>
              {activeExplanation.limitations.join(" · ")}
            </div>
          )}
        </section>
      )}

      {/* Retrieved Security Knowledge (RAG Evidence) Section */}
      <section className="mb-4 p-3.5 bg-slate-50 border border-slate-200 rounded-lg" data-testid="rag-evidence-section">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-xs text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
            <span>📚</span> Retrieved Security Knowledge (RAG Evidence)
          </h3>
          <span className="text-[11px] font-mono text-slate-500">
            {findingEvidence.length > 0
              ? `${findingEvidence.reduce((acc, f) => acc + (f.documents?.length || 0), 0)} sources`
              : "0 sources"}
          </span>
        </div>

        {findingEvidence.length > 0 ? (
          <div className="space-y-3">
            {findingEvidence.map((group, gIdx) => (
              <div key={gIdx} className="border-l-2 border-indigo-400 pl-2.5 py-0.5">
                <div className="text-[11px] font-bold text-indigo-900 mb-1">
                  Supports Finding:{" "}
                  <span className="font-mono bg-indigo-100 text-indigo-800 px-1 py-0.5 rounded text-[10px]">
                    {group.findingId}
                  </span>
                </div>
                {group.documents?.map((doc: any, dIdx: number) => (
                  <div key={dIdx} className="text-xs bg-white p-2.5 rounded border border-slate-200 mb-1.5 shadow-xs">
                    <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                      {doc.sourceUrl ? (
                        <a
                          href={doc.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-indigo-600 hover:underline flex items-center gap-1"
                        >
                          {doc.title} ↗
                        </a>
                      ) : (
                        <span className="font-semibold text-slate-800">{doc.title}</span>
                      )}
                      <div className="flex items-center gap-1.5">
                        {doc.trustLevel && (
                          <span
                            className={`text-[9px] uppercase px-1.5 py-0.5 rounded font-mono font-bold ${
                              doc.trustLevel === "authoritative"
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-blue-100 text-blue-800"
                            }`}
                          >
                            {doc.trustLevel}
                          </span>
                        )}
                        <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">
                          Relevance: {typeof doc.relevanceScore === "number" ? `${(doc.relevanceScore * 100).toFixed(0)}%` : "N/A"}
                        </span>
                      </div>
                    </div>
                    <p className="text-[11px] text-slate-600 line-clamp-3 italic">
                      "{doc.excerpt}"
                    </p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500 italic" data-testid="rag-empty-notice">
            {ragSummary || "No sufficiently relevant security documentation found."}
          </p>
        )}
      </section>

      {/* Visual Security Inspection Panels: Inner CPI Execution Tree */}
      <section className="mb-4">
        <CpiCallTree
          decoded={decodedTx}
          simulation={simulation}
          findings={riskAssessment?.breakdown ?? []}
        />
      </section>

      {/* Visual Security Inspection Panels: Pre/Post Account State Diff Matrix */}
      <section className="mb-4">
        <AccountDiffMatrix
          decoded={decodedTx}
          simulation={simulation}
        />
      </section>

      {/* Verifiable Security Audit Receipt Export (.json / .md) */}
      <section className="mb-4">
        <AuditReceiptExport
          base64Tx={base64Tx}
          sha256Hash={inspectedHash ?? ""}
          decodedTx={decodedTx}
          riskAssessment={riskAssessment}
          explanation={activeExplanation || legacyExplanation}
          isTampered={isTampered}
        />
      </section>

      {/* Decision / Action State */}
      <div className="pt-3 border-t mt-4">
        {state === "rejected" && (
          <div
            className="p-3 bg-red-50 text-red-800 border border-red-200 rounded text-sm font-semibold text-center"
            data-testid="status-rejected"
          >
            <div data-testid="rejected-notice">
              Transaction Rejected — Signing was not performed.
            </div>
          </div>
        )}

        {state === "signed" && (
          <div
            className="p-3 bg-green-50 text-green-800 border border-green-200 rounded text-sm font-semibold text-center"
            data-testid="status-signed"
          >
            Transaction Cryptographically Bound & Signed. Ready for manual broadcast.
          </div>
        )}

        {state === "signing" && (
          <div
            className="p-3 bg-indigo-50 text-indigo-800 border border-indigo-200 rounded text-sm font-semibold text-center"
            data-testid="status-signing"
          >
            Requesting wallet signature… Please approve in your wallet.
          </div>
        )}

        {state === "ready" && (
          <div className="flex space-x-3 justify-end">
            <button
              onClick={handleReject}
              className="px-4 py-2 border border-slate-300 rounded text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
              data-testid="reject-button"
            >
              Reject
            </button>
            <button
              onClick={handleApprove}
              className="px-4 py-2 bg-indigo-600 rounded text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              data-testid="approve-button"
            >
              Approve & Sign in Wallet
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
