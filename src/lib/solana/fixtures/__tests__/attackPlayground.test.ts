/** @jest-environment node */
// src/lib/solana/fixtures/__tests__/attackPlayground.test.ts
import { Keypair } from "@solana/web3.js";
import {
  generateAttackFixture,
  ATTACK_SCENARIOS,
  fetchDevnetBlockhash,
  DETERMINISTIC_FALLBACK_BLOCKHASH,
  SPL_TOKEN_PROGRAM_ID,
  MEMO_PROGRAM_ID,
  type AttackScenarioId,
} from "../attackPlayground";
import { decodeTransaction } from "../../../../solana/transactionDecoder";
import { computeRiskScore, type RuleResult } from "../../../../solana/transactionRiskScore";

describe("Phase 11 - One-Click Devnet Attack Playground & Live Payload Synthesizer", () => {
  const payer = Keypair.generate().publicKey;

  test("1. Registry contains exactly 5 defined scenarios", () => {
    expect(ATTACK_SCENARIOS.length).toBe(5);
    const ids = ATTACK_SCENARIOS.map((s) => s.id);
    expect(ids).toEqual([
      "benign-transfer",
      "set-authority-hijack",
      "unlimited-approve",
      "assign-memo-injection",
      "unknown-program",
    ]);
  });

  test("2. Scenario 1: Benign 0.05 SOL Transfer decodes cleanly and triggers SAFE tier", async () => {
    const fixture = await generateAttackFixture(
      "benign-transfer",
      payer,
      DETERMINISTIC_FALLBACK_BLOCKHASH,
    );

    expect(fixture.name).toBe("Benign 0.05 SOL Transfer");
    expect(fixture.badge).toBe("Synthesized Devnet Fixture");
    expect(fixture.version).toBe("legacy");
    expect(typeof fixture.base64Tx).toBe("string");

    const decoded = await decodeTransaction(fixture.base64Tx);
    expect(decoded.version).toBe("legacy");
    expect(decoded.instructions.length).toBe(1);

    const ix = decoded.instructions[0];
    expect(ix.programName).toBe("SystemProgram");
    expect((ix.data as any)?.type).toBe("Transfer");
    expect((ix.data as any)?.lamports).toBe(50_000_000); // 0.05 SOL

    const assessment = computeRiskScore(decoded);
    expect(assessment.riskLevel).toBe("LOW");
    expect(assessment.score).toBeLessThanOrEqual(30);
  });

  test("3. Scenario 2: SPL SetAuthority Account Hijack decodes cleanly as v0 and triggers VS-06", async () => {
    const fixture = await generateAttackFixture(
      "set-authority-hijack",
      payer,
      DETERMINISTIC_FALLBACK_BLOCKHASH,
    );

    expect(fixture.name).toBe("SPL SetAuthority Account Hijack");
    expect(fixture.badge).toBe("Synthesized Devnet Fixture");
    expect(fixture.version).toBe("v0");

    const decoded = await decodeTransaction(fixture.base64Tx);
    expect(decoded.version).toBe("v0");
    expect(decoded.instructions.length).toBe(1);

    const ix = decoded.instructions[0];
    expect(ix.programId).toBe(SPL_TOKEN_PROGRAM_ID.toBase58());
    expect((ix.data as any)?.type).toBe("SetAuthority");
    expect((ix.data as any)?.authorityTypeName).toBe("AccountOwner");

    const assessment = computeRiskScore(decoded);
    const ruleIds = assessment.breakdown.map((r: RuleResult) => r.id);
    expect(ruleIds).toContain("VS-06");
    const vs06 = assessment.breakdown.find((r: RuleResult) => r.id === "VS-06");
    expect(vs06?.severity).toBe(9); // Critical severity
  });

  test("4. Scenario 3: Unlimited SPL Delegate Drain decodes cleanly as v0 and triggers VS-05-APPROVE", async () => {
    const fixture = await generateAttackFixture(
      "unlimited-approve",
      payer,
      DETERMINISTIC_FALLBACK_BLOCKHASH,
    );

    expect(fixture.name).toBe("Unlimited SPL Delegate Drain");
    expect(fixture.badge).toBe("Synthesized Devnet Fixture");
    expect(fixture.version).toBe("v0");

    const decoded = await decodeTransaction(fixture.base64Tx);
    expect(decoded.version).toBe("v0");
    expect(decoded.instructions.length).toBe(1);

    const ix = decoded.instructions[0];
    expect(ix.programId).toBe(SPL_TOKEN_PROGRAM_ID.toBase58());
    expect((ix.data as any)?.type).toBe("Approve");
    expect((ix.data as any)?.rawTokenAmount).toBe("18446744073709551615"); // u64::MAX

    const assessment = computeRiskScore(decoded);
    const ruleIds = assessment.breakdown.map((r: RuleResult) => r.id);
    expect(ruleIds).toContain("VS-05-APPROVE");
    const vsApprove = assessment.breakdown.find((r: RuleResult) => r.id === "VS-05-APPROVE");
    expect(vsApprove?.severity).toBe(7); // High severity
  });

  test("5. Scenario 4: Silent Owner Reassignment + Memo Prompt Injection preserves deterministic STRS immunity", async () => {
    const fixture = await generateAttackFixture(
      "assign-memo-injection",
      payer,
      DETERMINISTIC_FALLBACK_BLOCKHASH,
    );

    expect(fixture.name).toBe("Silent Owner Reassignment + Memo Prompt Injection");
    expect(fixture.badge).toBe("Synthesized Devnet Fixture");
    expect(fixture.version).toBe("legacy");

    const decoded = await decodeTransaction(fixture.base64Tx);
    expect(decoded.instructions.length).toBe(2);

    // Instruction 0 is SystemProgram.assign
    const ix0 = decoded.instructions[0];
    expect(ix0.programName).toBe("SystemProgram");
    expect((ix0.data as any)?.type).toBe("Assign");

    // Instruction 1 is Memo with prompt injection string
    const ix1 = decoded.instructions[1];
    expect(ix1.programId).toBe(MEMO_PROGRAM_ID.toBase58());
    const memoText = ix1.rawBase64Data
      ? Buffer.from(ix1.rawBase64Data, "base64").toString("utf-8")
      : String(ix1.data);
    expect(memoText).toContain("SYSTEM OVERRIDE");

    // STRS must remain completely immune to the prompt injection attempt
    const assessment = computeRiskScore(decoded);
    const ruleIds = assessment.breakdown.map((r: RuleResult) => r.id);
    expect(ruleIds).toContain("VS-06-ASSIGN");
    const assignRule = assessment.breakdown.find((r: RuleResult) => r.id === "VS-06-ASSIGN");
    expect(assignRule?.severity).toBe(9); // Critical severity for ownership reassignment
    expect(assessment.score).toBeGreaterThanOrEqual(40);
  });

  test("6. Scenario 5: Opaque Unknown Program lowers confidence and flags uncertainty without false malice", async () => {
    const fixture = await generateAttackFixture(
      "unknown-program",
      payer,
      DETERMINISTIC_FALLBACK_BLOCKHASH,
    );

    expect(fixture.name).toBe("Opaque Unknown Program + Partial Simulation");
    expect(fixture.badge).toBe("Synthesized Devnet Fixture");
    expect(fixture.version).toBe("legacy");

    const decoded = await decodeTransaction(fixture.base64Tx);
    expect(decoded.instructions.length).toBe(1);

    const assessment = computeRiskScore(decoded);
    const ruleIds = assessment.breakdown.map((r: RuleResult) => r.id);
    expect(ruleIds).toContain("VS-02");

    const vs02 = assessment.breakdown.find((r: RuleResult) => r.id === "VS-02");
    // Unverified program is flagged with low severity caution (3), not falsely labeled malicious
    expect(vs02?.severity).toBe(3);
  });

  test("7. Blockhash resolver falls back to deterministic offline blockhash on unreachable endpoint", async () => {
    const result = await fetchDevnetBlockhash("http://127.0.0.1:9999/unreachable", 300);
    expect(result.blockhash).toBe(DETERMINISTIC_FALLBACK_BLOCKHASH);
    expect(result.isLive).toBe(false);
  });
});
