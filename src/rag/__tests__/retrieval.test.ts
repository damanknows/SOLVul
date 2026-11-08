// src/rag/__tests__/retrieval.test.ts
import { buildQueriesForFindings, buildQueryForFinding } from "../retrieval/queryBuilder";
import { filterAndRankChunks, mapChunksToFindingEvidence } from "../retrieval/relevance";
import { SecurityKnowledgeRetriever } from "../retrieval/retriever";
import { VectorStore } from "../storage/vectorStore";
import { LocalDeterministicEmbeddingService } from "../embeddings/embeddingService";
import { IngestionPipeline } from "../ingestion/ingest";
import { loadDocumentsFromDirectory } from "../ingestion/documentLoader";
import path from "path";
import type { FindingBreakdown } from "../../solana/transactionRiskScore";
import type { ScoredChunk, KnowledgeChunk } from "../types";

describe("Phase 8 - RAG Query Construction & Retrieval Pipeline", () => {
  test("1. Constructs targeted queries for all supported STRS finding types", () => {
    const findings: FindingBreakdown[] = [
      { id: "VS-01", description: "Large transfer", dimension: "amount", severity: 7, confidence: 1, explanation: "Large transfer", affectedAccounts: [], evidence: {} },
      { id: "VS-02", description: "Unknown program", dimension: "program", severity: 5, confidence: 1, explanation: "Unknown program", affectedAccounts: [], evidence: {} },
      { id: "VS-05-APPROVE", description: "Unlimited Approve", dimension: "amount", severity: 8, confidence: 1, explanation: "Unlimited Approve", affectedAccounts: [], evidence: {} },
      { id: "VS-06", description: "SetAuthority hijack", dimension: "authority", severity: 9, confidence: 1, explanation: "SetAuthority hijack", affectedAccounts: [], evidence: {} },
      { id: "VS-06-ASSIGN", description: "Account assign", dimension: "authority", severity: 9, confidence: 1, explanation: "Account assign", affectedAccounts: [], evidence: {} },
      { id: "VS-07", description: "CloseAccount drain", dimension: "authority", severity: 6, confidence: 1, explanation: "CloseAccount drain", affectedAccounts: [], evidence: {} },
      { id: "VS-08-ERR", description: "Simulation failure", dimension: "simulation", severity: 4, confidence: 1, explanation: "Simulation failure", affectedAccounts: [], evidence: {} },
      { id: "MEMO-INJECTION", description: "Adversarial memo injection", dimension: "complexity", severity: 8, confidence: 1, explanation: "Adversarial memo injection", affectedAccounts: [], evidence: {} },
    ];

    const queries = buildQueriesForFindings(findings);
    expect(queries.length).toBe(findings.length);

    const qApprove = queries.find((q) => q.findingId === "VS-05-APPROVE");
    expect(qApprove?.text).toContain("Approve");
    expect(qApprove?.category).toBe("token-security");

    const qAssign = queries.find((q) => q.findingId === "VS-06-ASSIGN");
    expect(qAssign?.text).toContain("Assign");
    expect(qAssign?.category).toBe("solana");

    const qSetAuth = queries.find((q) => q.findingId === "VS-06");
    expect(qSetAuth?.text).toContain("SetAuthority");

    const qMemo = queries.find((q) => q.findingId === "MEMO-INJECTION");
    expect(qMemo?.text).toContain("Memo");

    const qSim = queries.find((q) => q.findingId === "VS-08-ERR");
    expect(qSim?.text).toContain("simulation");
  });

  test("2. Relevance filter drops chunks below threshold and deduplicates by document", () => {
    const dummyChunk: KnowledgeChunk = {
      id: "chunk-a1",
      documentId: "doc-A",
      title: "Doc A",
      documentType: "official_docs",
      category: "solana",
      trustLevel: "authoritative",
      content: "Content A",
      createdAt: "2024-01-01T00:00:00Z",
      ingestedAt: "2024-01-01T00:00:00Z",
    };

    const scored: ScoredChunk[] = [
      { chunk: dummyChunk, relevanceScore: 0.85 },
      { chunk: { ...dummyChunk, id: "chunk-a2" }, relevanceScore: 0.80 }, // Duplicate doc-A
      { chunk: { ...dummyChunk, id: "chunk-b1", documentId: "doc-B" }, relevanceScore: 0.75 },
      { chunk: { ...dummyChunk, id: "chunk-c1", documentId: "doc-C" }, relevanceScore: 0.50 }, // Below threshold
    ];

    const filtered = filterAndRankChunks(scored, { minScore: 0.70, topK: 4, deduplicateByDocument: true });

    expect(filtered.length).toBe(2);
    expect(filtered[0].chunk.id).toBe("chunk-a1");
    expect(filtered[1].chunk.documentId).toBe("doc-B");
    expect(filtered.some((f) => f.chunk.documentId === "doc-C")).toBe(false);
  });

  test("3. Maps retrieved chunks specifically to the finding they support", () => {
    const dummyChunk1: KnowledgeChunk = {
      id: "chunk-approve",
      documentId: "doc-approve",
      title: "SPL Token Delegation",
      sourceUrl: "https://spl.solana.com/token",
      documentType: "official_docs",
      category: "token-security",
      trustLevel: "authoritative",
      content: "Approve instruction details",
      createdAt: "2024-01-01T00:00:00Z",
      ingestedAt: "2024-01-01T00:00:00Z",
    };

    const scored: ScoredChunk[] = [
      { chunk: dummyChunk1, relevanceScore: 0.92, findingId: "VS-05-APPROVE" },
    ];

    const mapped = mapChunksToFindingEvidence(scored);
    expect(mapped.length).toBe(1);
    expect(mapped[0].findingId).toBe("VS-05-APPROVE");
    expect(mapped[0].documents[0].documentId).toBe("chunk-approve");
    expect(mapped[0].documents[0].title).toBe("SPL Token Delegation");
    expect(mapped[0].documents[0].relevanceScore).toBe(0.92);
  });

  test("4. Full end-to-end retrieval with local knowledge base", async () => {
    const vectorStore = new VectorStore();
    const embeddingService = new LocalDeterministicEmbeddingService();
    const pipeline = new IngestionPipeline(vectorStore, undefined, embeddingService);

    const docs = loadDocumentsFromDirectory(path.join(process.cwd(), "knowledge"));
    await pipeline.ingestDocuments(docs);

    const retriever = new SecurityKnowledgeRetriever(vectorStore, embeddingService, {
      embeddingProvider: "local",
      embeddingModel: "local-deterministic-hash-128",
      minRelevanceScore: 0.25, // local hash dimension normalized threshold
      topK: 3,
      vectorStorePath: "",
      knowledgeDir: "",
      timeoutMs: 5000,
    });

    const findings: FindingBreakdown[] = [
      {
        id: "VS-05-APPROVE",
        description: "Unlimited token approve delegate drain",
        dimension: "amount",
        severity: 9,
        confidence: 1,
        explanation: "Unlimited token approve delegate drain",
        affectedAccounts: [],
        evidence: {},
      },
    ];

    const result = await retriever.retrieveForTransaction(undefined, findings, 0.2);

    expect(result.hasResults).toBe(true);
    expect(result.evidence.length).toBeGreaterThan(0);
    const approveFindingEvidence = result.evidence.find((e) => e.findingId === "VS-05-APPROVE");
    expect(approveFindingEvidence).toBeDefined();
    expect(approveFindingEvidence?.documents.length).toBeGreaterThan(0);
  });

  test("5. Reports honest missing result notice when no documents qualify", async () => {
    const vectorStore = new VectorStore();
    const embeddingService = new LocalDeterministicEmbeddingService();
    const retriever = new SecurityKnowledgeRetriever(vectorStore, embeddingService);

    const result = await retriever.retrieveForTransaction(undefined, [
      {
        id: "UNKNOWN",
        description: "unrelated",
        dimension: "complexity",
        severity: 1,
        confidence: 1,
        explanation: "unrelated",
        affectedAccounts: [],
        evidence: {},
      },
    ]);

    expect(result.hasResults).toBe(false);
    expect(result.evidence).toEqual([]);
    expect(result.missingEvidenceNotice).toBe("No sufficiently relevant security documentation found.");
  });
});
