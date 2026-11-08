// src/web/components/__tests__/preSigningSafetyAndAuditIntegrity.test.tsx
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import PreSigningFlow, {
  extractRequiredSigners,
  WalletProvider,
} from "../PreSigningFlow";
import {
  generateAuditReceipt,
  verifyAuditReceipt,
  SecurityAuditReceipt,
} from "../../../lib/audit/auditReceipt";
import * as cryptoUtils from "../../utils/crypto";

describe("Phase 16.4: Pre-Signing Safety and Audit Receipt Integrity", () => {
  let container: HTMLDivElement;
  let root: Root;
  let payer: Keypair;
  let recipient: Keypair;
  let validLegacyTxBase64: string;
  let validV0TxBase64: string;

  async function waitForElement(selector: string, timeout = 3000): Promise<Element> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = container.querySelector(selector);
      if (el) return el;
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20));
      });
    }
    throw new Error(`Timeout waiting for selector: ${selector}. HTML: ${container.innerHTML}`);
  }

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    payer = Keypair.generate();
    recipient = Keypair.generate();

    // 1. Valid Legacy Transaction
    const tx = new Transaction();
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = "11111111111111111111111111111111";
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 1_000_000,
      }),
    );
    validLegacyTxBase64 = Buffer.from(
      tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
    ).toString("base64");

    // 2. Valid Versioned Transaction (v0)
    const msgV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: recipient.publicKey,
          lamports: 2_000_000,
        }),
      ],
    }).compileToV0Message();
    const vtx = new VersionedTransaction(msgV0);
    validV0TxBase64 = Buffer.from(vtx.serialize()).toString("base64");
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    jest.restoreAllMocks();
  });

  // Test 1: Connected wallet matches required signer (signing proceeds)
  test("1. Connected wallet matches required signer (signing proceeds)", async () => {
    const onSignedMock = jest.fn();
    const signTransactionMock = jest.fn().mockImplementation(async (tx) => tx);
    const mockWallet: WalletProvider = {
      isPhantom: true,
      publicKey: payer.publicKey,
      signTransaction: signTransactionMock,
    };

    await act(async () => {
      root.render(
        <PreSigningFlow
          base64Tx={validLegacyTxBase64}
          onSigned={onSignedMock}
          walletProvider={mockWallet}
        />,
      );
    });

    const approveBtn = await waitForElement("[data-testid='approve-button']");
    await act(async () => {
      (approveBtn as HTMLButtonElement).click();
    });

    await waitForElement("[data-testid='status-signed']");
    expect(signTransactionMock).toHaveBeenCalledTimes(1);
    expect(onSignedMock).toHaveBeenCalledTimes(1);
  });

  // Test 2: Connected wallet does not match required signer (signing blocked with error)
  test("2. Connected wallet does not match required signer (signing blocked with error)", async () => {
    const attackerKeypair = Keypair.generate();
    const signTransactionMock = jest.fn();
    const mockWallet: WalletProvider = {
      isPhantom: true,
      publicKey: attackerKeypair.publicKey, // Mismatched pubkey!
      signTransaction: signTransactionMock,
    };

    await act(async () => {
      root.render(
        <PreSigningFlow
          base64Tx={validLegacyTxBase64}
          walletProvider={mockWallet}
        />,
      );
    });

    // Mismatch warning banner should be rendered
    const warningEl = await waitForElement("[data-testid='wallet-signer-mismatch-warning']");
    expect(warningEl.textContent).toContain("Wallet Signer Mismatch Detected");
    expect(warningEl.textContent).toContain(attackerKeypair.publicKey.toBase58());

    // Attempt to approve & sign
    const approveBtn = await waitForElement("[data-testid='approve-button']");
    await act(async () => {
      (approveBtn as HTMLButtonElement).click();
    });

    // Error view rendered with mismatch details
    const errorEl = await waitForElement("[data-testid='presigning-error']");
    expect(errorEl.textContent).toContain("Wallet Signer Mismatch");
    expect(errorEl.textContent).toContain("is not a required signer");

    // CRITICAL: signTransaction MUST NOT have been invoked
    expect(signTransactionMock).not.toHaveBeenCalled();
  });

  // Test 3: Missing signer / no required signers
  test("3. Missing signer / no required signers (signing blocked or error)", () => {
    // Empty transaction or decoded structure with 0 required signers
    const emptyTxInfo = extractRequiredSigners({
      version: "legacy",
      signatures: [],
      message: {
        accountKeys: [payer.publicKey.toBase58()],
        recentBlockhash: "11111111111111111111111111111111",
        instructionCount: 0,
        header: {
          numRequiredSignatures: 0, // No signers required
          numReadonlySignedAccounts: 0,
          numReadonlyUnsignedAccounts: 0,
        },
      },
      instructions: [],
    } as any);

    expect(emptyTxInfo.numRequiredSignatures).toBe(0);
    expect(emptyTxInfo.requiredSigners).toEqual([]);
    expect(emptyTxInfo.feePayer).toBeNull();
  });

  // Test 4: Legacy transaction signer extraction
  test("4. Legacy transaction signer extraction", () => {
    const signer2 = Keypair.generate();
    const tx = new Transaction();
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = "11111111111111111111111111111111";
    // Instruction requiring 2 signers
    tx.add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 5_000,
      }),
      SystemProgram.transfer({
        fromPubkey: signer2.publicKey,
        toPubkey: recipient.publicKey,
        lamports: 10_000,
      }),
    );

    const info = extractRequiredSigners(tx);
    expect(info.version).toBe("legacy");
    expect(info.feePayer).toBe(payer.publicKey.toBase58());
    expect(info.numRequiredSignatures).toBe(2);
    expect(info.requiredSigners).toContain(payer.publicKey.toBase58());
    expect(info.requiredSigners).toContain(signer2.publicKey.toBase58());
  });

  // Test 5: Versioned transaction signer extraction
  test("5. Versioned transaction signer extraction", () => {
    const msgV0 = new TransactionMessage({
      payerKey: payer.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: recipient.publicKey,
          lamports: 500_000,
        }),
      ],
    }).compileToV0Message();

    const vtx = new VersionedTransaction(msgV0);
    const info = extractRequiredSigners(vtx);

    expect(info.version).toBe("v0");
    expect(info.feePayer).toBe(payer.publicKey.toBase58());
    expect(info.numRequiredSignatures).toBe(1);
    expect(info.requiredSigners).toEqual([payer.publicKey.toBase58()]);
  });

  // Test 6: Transaction modified after inspection (TOCTOU hash mismatch aborts signing)
  test("6. Transaction modified after inspection (TOCTOU hash mismatch aborts signing)", async () => {
    const signTransactionMock = jest.fn();
    const mockWallet: WalletProvider = {
      isPhantom: true,
      publicKey: payer.publicKey,
      signTransaction: signTransactionMock,
    };

    let callCount = 0;
    jest.spyOn(cryptoUtils, "sha256").mockImplementation(async () => {
      callCount++;
      // Return original hash first during inspection, then modified hash prior to signing
      return callCount === 1 ? "inspected_sha256_digest" : "tampered_pre_sign_digest";
    });

    await act(async () => {
      root.render(
        <PreSigningFlow
          base64Tx={validLegacyTxBase64}
          walletProvider={mockWallet}
        />,
      );
    });

    const approveBtn = await waitForElement("[data-testid='approve-button']");
    await act(async () => {
      (approveBtn as HTMLButtonElement).click();
    });

    const errorEl = await waitForElement("[data-testid='presigning-error']");
    expect(errorEl.textContent).toContain("Payload Tampering Detected");

    const alertEl = await waitForElement("[data-testid='payload-tampering-alert']");
    expect(alertEl).not.toBeNull();

    // Invariant: wallet signTransaction MUST NEVER be called
    expect(signTransactionMock).not.toHaveBeenCalled();
  });

  // Test 7: Reject never invokes wallet signing
  test("7. Reject never invokes wallet signing", async () => {
    const signTransactionMock = jest.fn();
    const mockWallet: WalletProvider = {
      isPhantom: true,
      publicKey: payer.publicKey,
      signTransaction: signTransactionMock,
    };

    await act(async () => {
      root.render(
        <PreSigningFlow
          base64Tx={validLegacyTxBase64}
          walletProvider={mockWallet}
        />,
      );
    });

    const rejectBtn = await waitForElement("[data-testid='reject-button']");
    await act(async () => {
      (rejectBtn as HTMLButtonElement).click();
    });

    await waitForElement("[data-testid='status-rejected']");
    const notice = await waitForElement("[data-testid='rejected-notice']");
    expect(notice.textContent).toContain("Transaction Rejected — Signing was not performed.");

    // Invariant: wallet signTransaction MUST NEVER be called
    expect(signTransactionMock).not.toHaveBeenCalled();
  });

  // Test 8: Simulation unavailable rendered accurately
  test("8. Simulation unavailable rendered accurately", async () => {
    await act(async () => {
      root.render(
        <PreSigningFlow
          base64Tx={validLegacyTxBase64}
          simulation={{
            status: "unavailable",
            hasFullAccountDiff: false,
            limitations: ["RPC node offline"],
          }}
        />,
      );
    });

    const simPanel = await waitForElement("[data-testid='simulation-status-panel']");
    expect(simPanel).not.toBeNull();

    const simBadge = await waitForElement("[data-testid='simulation-status-badge']");
    expect(simBadge.textContent).toContain("Simulation Unavailable");

    const disclaimer = await waitForElement("[data-testid='simulation-disclaimer']");
    expect(disclaimer.textContent).toContain("RPC node is unreachable or offline");
  });

  // Test 9: Simulation failure rendered without claiming malice
  test("9. Simulation failure rendered without claiming malice", async () => {
    await act(async () => {
      root.render(
        <PreSigningFlow
          base64Tx={validLegacyTxBase64}
          simulation={{
            status: "failed",
            errorMessage: "BlockhashNotFound: blockhash expired or invalid",
            hasFullAccountDiff: false,
            limitations: ["Simulation reverted"],
          }}
        />,
      );
    });

    const simBadge = await waitForElement("[data-testid='simulation-status-badge']");
    expect(simBadge.textContent).toContain("Simulation Failed");

    const disclaimer = await waitForElement("[data-testid='simulation-disclaimer']");
    expect(disclaimer.textContent).toContain("BlockhashNotFound");
    // Crucial check: does not claim malice; notes non-malicious reasons like expired blockhashes or mock balances
    expect(disclaimer.textContent).toContain("does not necessarily indicate malicious intent");
    expect(disclaimer.textContent).toContain("expired recent blockhashes, insufficient Devnet/mock SOL");
  });

  // Test 10: Audit receipt with missing verification yields UNVERIFIED
  test("10. Audit receipt with missing verification yields UNVERIFIED", () => {
    const unverifiedReceipt = {
      version: "1.0.0",
      generator: "SOLVul Pre-Sign Firewall & Audit Engine",
      timestamp: new Date().toISOString(),
      payload: {
        sha256: "", // missing
        version: "legacy",
        wireBytesLength: 0,
        base64Payload: "", // missing
        recentBlockhash: "11111111111111111111111111111111",
        accountKeys: [],
        instructionCount: 0,
      },
      strsRiskScore: { score: 0, riskLevel: "SAFE", dimensionBreakdown: {} as any, triggeredRules: [] },
      ragCitations: [],
      geminiExplanation: { summary: "Test", risks: [], recommendations: [], findings: [] },
      cryptographicBinding: {
        algorithm: "SHA-256",
        toctouProtection: "Bit-for-bit pre-sign serialization equality verified",
        inspectedHash: "",
        status: "UNVERIFIED",
      },
    } as SecurityAuditReceipt;

    const res = verifyAuditReceipt(unverifiedReceipt);
    expect(res.status).toBe("UNVERIFIED");
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain("Missing required cryptographic verification data");
  });

  // Test 11: Audit receipt with valid integrity check yields VERIFIED
  test("11. Audit receipt with valid integrity check yields VERIFIED", () => {
    const rawBytes = Buffer.from(validLegacyTxBase64, "base64");
    const { createHash } = require("crypto");
    const validHash = createHash("sha256").update(rawBytes).digest("hex");

    const receipt = generateAuditReceipt({
      base64Tx: validLegacyTxBase64,
      sha256Hash: validHash,
      decodedTx: {
        version: "legacy",
        signatures: [],
        message: {
          accountKeys: [payer.publicKey.toBase58()],
          recentBlockhash: "11111111111111111111111111111111",
          instructionCount: 1,
        },
        instructions: [],
      } as any,
    });

    const res = verifyAuditReceipt(receipt);
    expect(res.status).toBe("VERIFIED");
    expect(res.isValid).toBe(true);
    expect(res.computedHash).toBe(validHash);
  });

  // Test 12: Audit receipt with modified contents yields TAMPERED
  test("12. Audit receipt with modified contents yields TAMPERED", () => {
    const rawBytes = Buffer.from(validLegacyTxBase64, "base64");
    const { createHash } = require("crypto");
    const validHash = createHash("sha256").update(rawBytes).digest("hex");

    const receipt = generateAuditReceipt({
      base64Tx: validLegacyTxBase64,
      sha256Hash: validHash,
    });

    // Mutate base64 payload to simulate post-inspection payload alteration
    const tampered = Buffer.from(receipt.payload.base64Payload, "base64");
    tampered[10] = (tampered[10] + 1) % 256;
    receipt.payload.base64Payload = tampered.toString("base64");

    const res = verifyAuditReceipt(receipt);
    expect(res.status).toBe("TAMPERED");
    expect(res.isValid).toBe(false);
    expect(res.reason).toContain("Cryptographic");
  });
});
