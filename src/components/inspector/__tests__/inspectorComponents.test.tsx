// src/components/inspector/__tests__/inspectorComponents.test.tsx
import React, { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { CpiCallTree } from "../CpiCallTree";
import { AccountDiffMatrix } from "../AccountDiffMatrix";
import type { CpiCallNode, AccountStateDiff } from "../types";

describe("Inspector Components", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  describe("CpiCallTree Component", () => {
    test("1. Renders empty state when no nodes provided", async () => {
      await act(async () => {
        root.render(<CpiCallTree nodes={[]} />);
      });

      const emptyEl = container.querySelector("[data-testid='cpi-tree-empty']");
      expect(emptyEl).not.toBeNull();
      expect(emptyEl?.textContent).toContain("No instructions or CPI calls detected");
    });

    test("2. Renders tree nodes, depth badges, and privilege escalation flags", async () => {
      const mockNodes: CpiCallNode[] = [
        {
          id: "top-0",
          depth: 0,
          callerProgramId: "Wallet",
          callerProgramName: "User Wallet",
          calleeProgramId: "11111111111111111111111111111111",
          calleeProgramName: "SystemProgram",
          instructionName: "Transfer",
          isSignerEscalation: false,
          isWritableEscalation: false,
          accounts: [{ pubkey: "Account1", isSigner: true, isWritable: true }],
          triggeredRules: ["VS-04"],
          children: [
            {
              id: "cpi-0-0",
              depth: 1,
              callerProgramId: "11111111111111111111111111111111",
              callerProgramName: "SystemProgram",
              calleeProgramId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
              calleeProgramName: "TokenProgram",
              instructionName: "CPI Invocation",
              isSignerEscalation: true,
              isWritableEscalation: true,
              accounts: [],
              triggeredRules: ["VS-02"],
              children: [],
              status: "success",
            },
          ],
        },
      ];

      await act(async () => {
        root.render(<CpiCallTree nodes={mockNodes} />);
      });

      // Assert tree rendered
      expect(container.querySelector("[data-testid='cpi-call-tree']")).not.toBeNull();

      // Assert top-level and inner node
      expect(container.querySelector("[data-testid='cpi-node-top-0']")).not.toBeNull();
      expect(container.querySelector("[data-testid='cpi-node-cpi-0-0']")).not.toBeNull();

      // Assert privilege escalation badges
      expect(container.querySelector("[data-testid='signer-escalation-badge']")).not.toBeNull();
      expect(container.querySelector("[data-testid='writable-escalation-badge']")).not.toBeNull();

      // Assert exact rule badges
      expect(container.querySelector("[data-testid='rule-badge-VS-04']")).not.toBeNull();
      expect(container.querySelector("[data-testid='rule-badge-VS-02']")).not.toBeNull();
    });

    test("3. Supports collapsing and expanding child CPI nodes", async () => {
      const mockNodes: CpiCallNode[] = [
        {
          id: "top-0",
          depth: 0,
          callerProgramId: "Wallet",
          calleeProgramId: "SystemProgram",
          instructionName: "Transfer",
          isSignerEscalation: false,
          isWritableEscalation: false,
          accounts: [],
          triggeredRules: [],
          children: [
            {
              id: "cpi-child-1",
              depth: 1,
              callerProgramId: "SystemProgram",
              calleeProgramId: "TokenProgram",
              instructionName: "InnerTransfer",
              isSignerEscalation: false,
              isWritableEscalation: false,
              accounts: [],
              triggeredRules: [],
              children: [],
            },
          ],
        },
      ];

      await act(async () => {
        root.render(<CpiCallTree nodes={mockNodes} />);
      });

      // Child is visible initially
      expect(container.querySelector("[data-testid='cpi-node-cpi-child-1']")).not.toBeNull();

      // Click collapse button
      const toggleBtn = container.querySelector("button[aria-label='Collapse CPI invocations']");
      expect(toggleBtn).not.toBeNull();

      await act(async () => {
        (toggleBtn as HTMLButtonElement).click();
      });

      // Child should now be hidden
      expect(container.querySelector("[data-testid='cpi-node-cpi-child-1']")).toBeNull();
    });
  });

  describe("AccountDiffMatrix Component", () => {
    test("1. Renders empty state when no diffs exist", async () => {
      await act(async () => {
        root.render(<AccountDiffMatrix diffs={[]} />);
      });

      expect(container.querySelector("[data-testid='account-diff-empty']")).not.toBeNull();
    });

    test("2. Highlights account owner mutation in crimson", async () => {
      const mockDiffs: AccountStateDiff[] = [
        {
          pubkey: "TargetAccount111111111111111111111111111111",
          label: "Hijacked Account",
          isWritable: true,
          isSigner: true,
          preLamports: 1_000_000_000,
          postLamports: 1_000_000_000,
          lamportsDelta: 0,
          preOwner: "11111111111111111111111111111111",
          postOwner: "AttackerProgram11111111111111111111111111111",
          isOwnerMutated: true,
          preDataLen: 0,
          postDataLen: 0,
          dataLenDelta: 0,
          provenance: "Inferred from Static Instruction",
        },
      ];

      await act(async () => {
        root.render(<AccountDiffMatrix diffs={mockDiffs} />);
      });

      // Crimson owner mutation highlighted in table cell
      const crimsonEl = container.querySelector("[data-testid='crimson-owner-mutation']");
      expect(crimsonEl).not.toBeNull();
      expect(crimsonEl?.textContent).toContain("Owner Hijacked");

      // Critical banner present
      expect(container.querySelector("[data-testid='owner-mutation-alert-banner']")).not.toBeNull();
      expect(container.querySelector("[data-testid='owner-mutated-warning-pill']")).not.toBeNull();
    });

    test("3. Explicitly displays provenance badges: Verified RPC vs Inferred Static", async () => {
      const mockDiffs: AccountStateDiff[] = [
        {
          pubkey: "AccountVerified1111111111111111111111111111",
          isWritable: true,
          isSigner: true,
          preLamports: 2_000_000_000,
          postLamports: 1_900_000_000,
          lamportsDelta: -100_000_000,
          preOwner: "SystemProgram",
          postOwner: "SystemProgram",
          isOwnerMutated: false,
          preDataLen: 0,
          postDataLen: 0,
          dataLenDelta: 0,
          provenance: "Verified via RPC Snapshot",
        },
        {
          pubkey: "AccountInferred1111111111111111111111111111",
          isWritable: true,
          isSigner: false,
          preLamports: 1_000_000_000,
          postLamports: 1_100_000_000,
          lamportsDelta: 100_000_000,
          preOwner: "SystemProgram",
          postOwner: "SystemProgram",
          isOwnerMutated: false,
          preDataLen: 0,
          postDataLen: 0,
          dataLenDelta: 0,
          provenance: "Inferred from Static Instruction",
        },
      ];

      await act(async () => {
        root.render(<AccountDiffMatrix diffs={mockDiffs} />);
      });

      expect(container.querySelector("[data-testid='provenance-verified']")).not.toBeNull();
      expect(container.querySelector("[data-testid='provenance-inferred']")).not.toBeNull();
    });
  });
});
