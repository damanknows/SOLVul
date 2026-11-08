/**
 * @jest-environment node
 */
// src/solana/transactionRiskScore.test.ts
import { computeRiskScore, DEFAULT_RISK_CONFIG } from "./transactionRiskScore";
import { decodeTransaction } from "./transactionDecoder";
import {
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
  createApproveInstruction,
  createSetAuthorityInstruction,
  createCloseAccountInstruction,
  createTransferInstruction,
  AuthorityType,
} from "@solana/spl-token";

const DUMMY_BLOCKHASH = "11111111111111111111111111111111";

describe("STRS Risk Scoring — Phase 5 Deterministic Evidence-Based Scoring", () => {
  test("unsigned transaction is NOT inherently suspicious (no VS-04 unsigned penalty)", async () => {
    const from = Keypair.generate();
    const to = Keypair.generate().publicKey;
    const tx = new Transaction();
    tx.feePayer = from.publicKey;
    tx.recentBlockhash = DUMMY_BLOCKHASH;
    tx.add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: 1_000_000 }));
    const base64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");

    const decoded = await decodeTransaction(base64);
    const result = computeRiskScore(decoded, DEFAULT_RISK_CONFIG);

    // Verified: Clean small transfer yields 0 score and LOW risk level
    expect(result.score).toBe(0);
    expect(result.riskLevel).toBe("LOW");
    expect(result.breakdown).toHaveLength(0);
    expect(result.breakdown.some((f) => f.id === "VS-04" && f.description.includes("Unsigned"))).toBe(false);
  });

  test("large SOL transfer triggers VS-01 with exact lamports evidence", async () => {
    const from = Keypair.generate();
    const to = Keypair.generate().publicKey;
    const tx = new Transaction();
    tx.feePayer = from.publicKey;
    tx.recentBlockhash = DUMMY_BLOCKHASH;
    tx.add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: 20_000_000_000 })); // 20 SOL
    const base64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");

    const decoded = await decodeTransaction(base64);
    const result = computeRiskScore(decoded, DEFAULT_RISK_CONFIG);

    expect(result.score).toBeGreaterThan(0);
    const vs01 = result.breakdown.find((r) => r.id === "VS-01");
    expect(vs01).toBeDefined();
    expect(vs01?.evidence.lamports).toBe(20_000_000_000);
    expect(vs01?.affectedAccounts).toContain(from.publicKey.toBase58());
    expect(vs01?.affectedAccounts).toContain(to.toBase58());
  });

  test("unknown program produces an unverified-program finding (VS-02), not a malicious verdict", async () => {
    const from = Keypair.generate();
    const unknownProgram = Keypair.generate().publicKey;
    const ix = new TransactionInstruction({
      programId: unknownProgram,
      keys: [{ pubkey: from.publicKey, isSigner: true, isWritable: true }],
      data: Buffer.from([0x01]),
    });
    const tx = new Transaction();
    tx.feePayer = from.publicKey;
    tx.recentBlockhash = DUMMY_BLOCKHASH;
    tx.add(ix);
    const base64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");

    const decoded = await decodeTransaction(base64);
    const result = computeRiskScore(decoded, DEFAULT_RISK_CONFIG);

    const vs02 = result.breakdown.find((r) => r.id === "VS-02");
    expect(vs02).toBeDefined();
    expect(vs02?.severity).toBe(3); // Low severity
    expect(vs02?.description).toBe("Unverified Program Interaction");
    expect(vs02?.limitations).toContain("not automatically malicious");
  });

  test("multiple SOL transfers trigger batch transfer detection (VS-01-MULTI)", async () => {
    const from = Keypair.generate();
    const tx = new Transaction();
    tx.feePayer = from.publicKey;
    tx.recentBlockhash = DUMMY_BLOCKHASH;
    tx.add(
      SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 100 }),
      SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 200 }),
      SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 300 }),
    );
    const base64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");

    const decoded = await decodeTransaction(base64);
    const result = computeRiskScore(decoded, DEFAULT_RISK_CONFIG);

    const multi = result.breakdown.find((r) => r.id === "VS-01-MULTI");
    expect(multi).toBeDefined();
    expect(multi?.evidence.transferCount).toBe(3);
  });

  test("token delegate approval triggers VS-05-APPROVE with affected accounts", async () => {
    const owner = Keypair.generate();
    const source = Keypair.generate().publicKey;
    const delegate = Keypair.generate().publicKey;

    const ix = createApproveInstruction(source, delegate, owner.publicKey, 1_000_000n, [], TOKEN_PROGRAM_ID);
    const tx = new Transaction();
    tx.feePayer = owner.publicKey;
    tx.recentBlockhash = DUMMY_BLOCKHASH;
    tx.add(ix);
    const base64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");

    const decoded = await decodeTransaction(base64);
    const result = computeRiskScore(decoded, DEFAULT_RISK_CONFIG);

    const approveFinding = result.breakdown.find((r) => r.id === "VS-05-APPROVE");
    expect(approveFinding).toBeDefined();
    expect(approveFinding?.affectedAccounts).toContain(delegate.toBase58());
    expect(approveFinding?.affectedAccounts).toContain(owner.publicKey.toBase58());
  });

  test("token SetAuthority ownership change triggers high severity VS-06", async () => {
    const owner = Keypair.generate();
    const source = Keypair.generate().publicKey;
    const attacker = Keypair.generate().publicKey;

    const ix = createSetAuthorityInstruction(
      source,
      owner.publicKey,
      AuthorityType.AccountOwner,
      attacker,
      [],
      TOKEN_PROGRAM_ID,
    );
    const tx = new Transaction();
    tx.feePayer = owner.publicKey;
    tx.recentBlockhash = DUMMY_BLOCKHASH;
    tx.add(ix);
    const base64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");

    const decoded = await decodeTransaction(base64);
    const result = computeRiskScore(decoded, DEFAULT_RISK_CONFIG);

    const vs06 = result.breakdown.find((r) => r.id === "VS-06");
    expect(vs06).toBeDefined();
    expect(vs06?.severity).toBe(9);
    expect(result.score).toBeGreaterThanOrEqual(75);
    expect(result.riskLevel).toBe("CRITICAL");
  });

  test("SystemProgram::Assign triggers critical severity VS-06-ASSIGN", async () => {
    const owner = Keypair.generate();
    const programId = Keypair.generate().publicKey;

    const ix = SystemProgram.assign({
      accountPubkey: owner.publicKey,
      programId,
    });
    const tx = new Transaction();
    tx.feePayer = owner.publicKey;
    tx.recentBlockhash = DUMMY_BLOCKHASH;
    tx.add(ix);
    const base64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");

    const decoded = await decodeTransaction(base64);
    const result = computeRiskScore(decoded, DEFAULT_RISK_CONFIG);

    const assignFinding = result.breakdown.find((r) => r.id === "VS-06-ASSIGN");
    expect(assignFinding).toBeDefined();
    expect(assignFinding?.severity).toBe(9);
    expect(result.riskLevel).toBe("CRITICAL");
  });

  test("token account closure triggers VS-07", async () => {
    const owner = Keypair.generate();
    const account = Keypair.generate().publicKey;
    const rentDest = Keypair.generate().publicKey;

    const ix = createCloseAccountInstruction(account, rentDest, owner.publicKey, [], TOKEN_PROGRAM_ID);
    const tx = new Transaction();
    tx.feePayer = owner.publicKey;
    tx.recentBlockhash = DUMMY_BLOCKHASH;
    tx.add(ix);
    const base64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");

    const decoded = await decodeTransaction(base64);
    const result = computeRiskScore(decoded, DEFAULT_RISK_CONFIG);

    const vs07 = result.breakdown.find((r) => r.id === "VS-07");
    expect(vs07).toBeDefined();
    expect(vs07?.evidence.closedAccount).toBe(account.toBase58());
  });

  test("simulation failure triggers VS-08-ERR", async () => {
    const from = Keypair.generate();
    const tx = new Transaction();
    tx.feePayer = from.publicKey;
    tx.recentBlockhash = DUMMY_BLOCKHASH;
    tx.add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: from.publicKey, lamports: 100 }));
    const base64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");

    const decoded = await decodeTransaction(base64);
    const fakeSim: any = {
      status: "failed",
      errorMessage: "InstructionError: Custom 1",
      error: { InstructionError: [0, 1] },
      hasFullAccountDiff: false,
      limitations: [],
    };

    const result = computeRiskScore(decoded, DEFAULT_RISK_CONFIG, fakeSim);
    const vs08 = result.breakdown.find((r) => r.id === "VS-08-ERR");
    expect(vs08).toBeDefined();
    expect(vs08?.evidence.error).toBeDefined();
  });

  test("STRS score is mathematically bounded between 0 and 100", async () => {
    const from = Keypair.generate();
    const tx = new Transaction();
    tx.feePayer = from.publicKey;
    tx.recentBlockhash = DUMMY_BLOCKHASH;

    // Stack multiple high risk instructions
    for (let i = 0; i < 10; i++) {
      tx.add(
        SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 50_000_000_000 }),
      );
    }
    const base64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");

    const decoded = await decodeTransaction(base64);
    const fakeSim: any = {
      status: "failed",
      errorMessage: "reverted",
      hasFullAccountDiff: false,
      limitations: [],
    };

    const result = computeRiskScore(decoded, DEFAULT_RISK_CONFIG, fakeSim);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  test("same evidence always produces the exact same deterministic score", async () => {
    const from = Keypair.generate();
    const tx = new Transaction();
    tx.feePayer = from.publicKey;
    tx.recentBlockhash = DUMMY_BLOCKHASH;
    tx.add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 15_000_000_000 }));
    const base64 = Buffer.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false })).toString("base64");

    const decoded1 = await decodeTransaction(base64);
    const decoded2 = await decodeTransaction(base64);

    const score1 = computeRiskScore(decoded1, DEFAULT_RISK_CONFIG);
    const score2 = computeRiskScore(decoded2, DEFAULT_RISK_CONFIG);

    expect(score1.score).toBe(score2.score);
    expect(score1.riskLevel).toBe(score2.riskLevel);
    expect(score1.confidence).toBe(score2.confidence);
  });
});
