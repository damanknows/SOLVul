// src/components/inspector/__tests__/cpiParser.test.ts
import { parseCpiCallTree } from "../cpiParser";
import type { DecodedTransaction } from "../../../solana/transactionDecoder";
import type { SimulationResult } from "../../../solana/simulateTransaction";
import type { RuleResult } from "../../../solana/transactionRiskScore";

describe("CPI Call Tree Parser", () => {
  const dummyDecoded: DecodedTransaction = {
    version: "v0",
    signatures: [],
    message: {
      accountKeys: [
        "Payer11111111111111111111111111111111111111",
        "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
        "Target11111111111111111111111111111111111111",
        "11111111111111111111111111111111",
      ],
      recentBlockhash: "11111111111111111111111111111111",
      instructionCount: 1,
    },
    instructions: [
      {
        programId: "11111111111111111111111111111111",
        programName: "SystemProgram",
        isUnsupported: false,
        accounts: [
          { pubkey: "Payer11111111111111111111111111111111111111", isSigner: true, isWritable: true },
          { pubkey: "Target11111111111111111111111111111111111111", isSigner: false, isWritable: true },
        ],
        data: { type: "Transfer", lamports: 1000 },
      },
    ],
  };

  test("1. Parses top-level instruction when no CPI or logs exist", () => {
    const nodes = parseCpiCallTree(dummyDecoded, null, []);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].depth).toBe(0);
    expect(nodes[0].callerProgramName).toBe("User Wallet");
    expect(nodes[0].calleeProgramName).toBe("SystemProgram");
    expect(nodes[0].instructionName).toBe("Transfer");
    expect(nodes[0].children).toHaveLength(0);
    expect(nodes[0].isSignerEscalation).toBe(false);
    expect(nodes[0].isWritableEscalation).toBe(false);
  });

  test("2. Maps RPC innerInstructions to child CPI nodes", () => {
    const mockSimulation: SimulationResult = {
      status: "success",
      hasFullAccountDiff: false,
      limitations: [],
      innerInstructions: [
        {
          index: 0,
          instructions: [
            {
              programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
              stackHeight: 2,
              accounts: ["Target11111111111111111111111111111111111111"],
              data: "Base64InnerData",
            },
          ],
        },
      ],
    };

    const nodes = parseCpiCallTree(dummyDecoded, mockSimulation, []);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].children).toHaveLength(1);

    const child = nodes[0].children[0];
    expect(child.depth).toBe(2);
    expect(child.callerProgramId).toBe(dummyDecoded.instructions[0].programId);
    expect(child.calleeProgramId).toBe("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    expect(child.calleeProgramName).toBe("TokenProgram");
    expect(child.rawData).toBe("Base64InnerData");
  });

  test("3. Reconstructs CPI hierarchy from validator execution logs when innerInstructions are absent", () => {
    const mockSimulationWithLogs: SimulationResult = {
      status: "success",
      hasFullAccountDiff: false,
      limitations: [],
      logs: [
        "Program 11111111111111111111111111111111 invoke [1]",
        "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [2]",
        "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success",
        "Program 11111111111111111111111111111111 success",
      ],
    };

    const nodes = parseCpiCallTree(dummyDecoded, mockSimulationWithLogs, []);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].children).toHaveLength(1);
    expect(nodes[0].children[0].calleeProgramId).toBe("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    expect(nodes[0].children[0].depth).toBe(2);
    expect(nodes[0].children[0].instructionName).toBe("CPI Invocation (from Logs)");
  });

  test("4. Flags privilege escalation in CPI invocations", () => {
    const mockSimulationWithEscalation: SimulationResult = {
      status: "success",
      hasFullAccountDiff: false,
      limitations: [],
      innerInstructions: [
        {
          index: 0,
          instructions: [
            {
              programId: "CustomProgram111111111111111111111111111111",
              stackHeight: 2,
              // Account not writable in parent top-level instruction
              accounts: ["UnwritableInParent111111111111111111111111"],
            },
          ],
        },
      ],
    };

    const nodes = parseCpiCallTree(dummyDecoded, mockSimulationWithEscalation, []);
    expect(nodes[0].children[0].isWritableEscalation).toBe(true);
  });

  test("5. Associates triggered rule IDs with top-level and inner nodes", () => {
    const findings: RuleResult[] = [
      {
        id: "VS-02",
        severity: 7,
        confidence: 0.9,
        description: "Transaction invokes unverified program",
        explanation: "Unverified custom program invoked.",
        evidence: {},
        affectedAccounts: [],
        dimension: "program",
        instructionIndex: 0,
      },
      {
        id: "VS-06",
        severity: 9,
        confidence: 1.0,
        description: "Deprecated program detected",
        explanation: "Deprecated program detected.",
        evidence: {},
        affectedAccounts: ["Target11111111111111111111111111111111111111"],
        dimension: "program",
      },
    ];

    const nodes = parseCpiCallTree(dummyDecoded, null, findings);
    expect(nodes[0].triggeredRules).toContain("VS-02");
    expect(nodes[0].triggeredRules).toContain("VS-06");
  });

  test("6. Returns empty array for null/empty decoded transaction", () => {
    expect(parseCpiCallTree(null, null, [])).toEqual([]);
    expect(parseCpiCallTree({ ...dummyDecoded, instructions: [] }, null, [])).toEqual([]);
  });
});
