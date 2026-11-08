// src/web/components/PreSigningFlow.test.tsx
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import PreSigningFlow, { WalletProvider } from "./PreSigningFlow";
import * as cryptoUtils from "../utils/crypto";

describe("PreSigningFlow Component", () => {
  let container: HTMLDivElement;
  let root: Root;
  let payer: Keypair;
  let validTxBase64: string;

  // Poll until element matching selector appears
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
    const recipient = Keypair.generate();
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
    validTxBase64 = Buffer.from(
      tx.serialize({ requireAllSignatures: false, verifySignatures: false }),
    ).toString("base64");
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    jest.restoreAllMocks();
  });

  test("1. Reject never calls wallet signing", async () => {
    const signTransactionMock = jest.fn();
    const mockWallet: WalletProvider = {
      isPhantom: true,
      publicKey: payer.publicKey,
      signTransaction: signTransactionMock,
    };

    await act(async () => {
      root.render(
        <PreSigningFlow
          base64Tx={validTxBase64}
          walletProvider={mockWallet}
        />,
      );
    });

    const rejectBtn = await waitForElement("[data-testid='reject-button']");
    await act(async () => {
      (rejectBtn as HTMLButtonElement).click();
    });

    await waitForElement("[data-testid='status-rejected']");

    // CRITICAL: signTransaction MUST NOT have been called
    expect(signTransactionMock).not.toHaveBeenCalled();
  });

  test("2. Approval calls signing once and notifies onSigned callback", async () => {
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
          base64Tx={validTxBase64}
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
    expect(typeof onSignedMock.mock.calls[0][0]).toBe("string");
  });

  test("3. Signing failure shows error state", async () => {
    const signTransactionMock = jest.fn().mockRejectedValue(new Error("User rejected signature request"));
    const mockWallet: WalletProvider = {
      isPhantom: true,
      publicKey: payer.publicKey,
      signTransaction: signTransactionMock,
    };

    await act(async () => {
      root.render(
        <PreSigningFlow
          base64Tx={validTxBase64}
          walletProvider={mockWallet}
        />,
      );
    });

    const approveBtn = await waitForElement("[data-testid='approve-button']");
    await act(async () => {
      (approveBtn as HTMLButtonElement).click();
    });

    const errorEl = await waitForElement("[data-testid='presigning-error']");
    expect(errorEl.textContent).toContain("User rejected signature request");
  });

  test("4. Hash mismatch blocks signing (Cryptographic TOCTOU Tampering Protection)", async () => {
    const signTransactionMock = jest.fn();
    const mockWallet: WalletProvider = {
      isPhantom: true,
      publicKey: payer.publicKey,
      signTransaction: signTransactionMock,
    };

    // Spy on sha256: return a different hash during pre-sign check to simulate TOCTOU tampering
    let callCount = 0;
    jest.spyOn(cryptoUtils, "sha256").mockImplementation(async () => {
      callCount++;
      return callCount === 1 ? "original_inspected_hash" : "altered_pre_sign_hash";
    });

    await act(async () => {
      root.render(
        <PreSigningFlow
          base64Tx={validTxBase64}
          walletProvider={mockWallet}
        />,
      );
    });

    const approveBtn = await waitForElement("[data-testid='approve-button']");
    expect(approveBtn.textContent).toContain("Approve & Sign in Wallet");

    await act(async () => {
      (approveBtn as HTMLButtonElement).click();
    });

    // Verify critical Payload Tampering Detected alert
    const errorEl = await waitForElement("[data-testid='presigning-error']");
    expect(errorEl.textContent).toContain("Payload Tampering Detected");
    expect(errorEl.textContent).toContain("Cryptographic transaction binding mismatch");

    const tamperingAlert = await waitForElement("[data-testid='payload-tampering-alert']");
    expect(tamperingAlert).not.toBeNull();

    // Invariant: signTransaction MUST NOT be invoked when tampering is detected
    expect(signTransactionMock).not.toHaveBeenCalled();
  });

  test("5. Double click is prevented", async () => {
    let resolveSigning: (val: any) => void;
    let receivedTx: any = null;
    const signPromise = new Promise((resolve) => {
      resolveSigning = resolve;
    });

    const signTransactionMock = jest.fn().mockImplementation((tx) => {
      receivedTx = tx;
      return signPromise;
    });
    const mockWallet: WalletProvider = {
      isPhantom: true,
      publicKey: payer.publicKey,
      signTransaction: signTransactionMock,
    };

    await act(async () => {
      root.render(
        <PreSigningFlow
          base64Tx={validTxBase64}
          walletProvider={mockWallet}
        />,
      );
    });

    const approveBtn = await waitForElement("[data-testid='approve-button']");

    // Click twice rapidly
    await act(async () => {
      (approveBtn as HTMLButtonElement).click();
      (approveBtn as HTMLButtonElement).click();
    });

    // Resolve signing with the received valid transaction
    await act(async () => {
      resolveSigning!(receivedTx);
    });

    await waitForElement("[data-testid='status-signed']");

    // signTransaction must only be called once
    expect(signTransactionMock).toHaveBeenCalledTimes(1);
  });

  test("6. Prominently displays SHA-256 wire payload fingerprint and decoded message header counts", async () => {
    await act(async () => {
      root.render(<PreSigningFlow base64Tx={validTxBase64} />);
    });

    const fingerprintPanel = await waitForElement("[data-testid='payload-fingerprint-panel']");
    expect(fingerprintPanel).not.toBeNull();

    const fingerprintEl = await waitForElement("[data-testid='payload-sha256-fingerprint']");
    expect(fingerprintEl.textContent).toBeTruthy();
    expect(fingerprintEl.textContent?.length).toBe(64); // SHA-256 hex string length

    expect(fingerprintPanel.textContent).toContain("Req. Signatures");
    expect(fingerprintPanel.textContent).toContain("Total Accounts");
  });

  test("7. Renders downloadable Audit Receipt Export card with JSON and Markdown buttons", async () => {
    await act(async () => {
      root.render(<PreSigningFlow base64Tx={validTxBase64} />);
    });

    const exportCard = await waitForElement("[data-testid='audit-receipt-export-card']");
    expect(exportCard).not.toBeNull();

    expect(container.querySelector("[data-testid='download-receipt-json-btn']")).not.toBeNull();
    expect(container.querySelector("[data-testid='download-receipt-md-btn']")).not.toBeNull();
  });
});
