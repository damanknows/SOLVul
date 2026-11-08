// src/rag/__tests__/vectorStore.test.ts
import fs from "fs";
import path from "path";
import { VectorStore, cosineSimilarity, hashContent } from "../storage/vectorStore";
import type { VectorEntry, KnowledgeChunk } from "../types";

describe("Phase 8 - VectorStore and Similarity Search", () => {
  const tmpDir = path.join(process.cwd(), "tmp_test_rag");
  const tmpFile = path.join(tmpDir, "test_store.json");

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  const sampleChunk: KnowledgeChunk = {
    id: "chunk-1",
    documentId: "doc-1",
    title: "SPL Token Approve Security",
    sourceUrl: "https://spl.solana.com/token",
    documentType: "official_docs",
    category: "token-security",
    trustLevel: "authoritative",
    content: "Approve instruction delegates token transfer authority to a delegate address.",
    createdAt: "2024-01-01T00:00:00Z",
    ingestedAt: "2024-01-01T00:00:00Z",
  };

  test("1. Cosine similarity computes exact geometric angle", () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    const v3 = [0, 1, 0];
    const v4 = [-1, 0, 0];

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1.0, 5);
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(0.0, 5);
    expect(cosineSimilarity(v1, v4)).toBeCloseTo(-1.0, 5);
    expect(cosineSimilarity([], [1, 2])).toBe(0);
  });

  test("2. VectorStore searches and ranks by cosine similarity", () => {
    const store = new VectorStore();

    const entry1: VectorEntry = {
      id: "chunk-1",
      vector: [1.0, 0.0],
      chunk: sampleChunk,
      contentHash: hashContent(sampleChunk.content),
    };

    const entry2: VectorEntry = {
      id: "chunk-2",
      vector: [0.7071, 0.7071],
      chunk: { ...sampleChunk, id: "chunk-2", content: "Second chunk" },
      contentHash: hashContent("Second chunk"),
    };

    store.addEntry(entry1);
    store.addEntry(entry2);
    store.setInitialized(true);

    const query = [1.0, 0.0];
    const results = store.search(query, { topK: 2 });

    expect(results.length).toBe(2);
    expect(results[0].chunk.id).toBe("chunk-1");
    expect(results[0].relevanceScore).toBeCloseTo(1.0, 2);
    expect(results[1].chunk.id).toBe("chunk-2");
    expect(results[1].relevanceScore).toBeCloseTo(0.707, 2);
  });

  test("3. VectorStore supports category and trustLevel metadata filtering", () => {
    const store = new VectorStore();

    store.addEntry({
      id: "token-chunk",
      vector: [1.0, 0.0],
      chunk: { ...sampleChunk, id: "token-chunk", category: "token-security", trustLevel: "authoritative" },
      contentHash: "hash-token",
    });

    store.addEntry({
      id: "program-chunk",
      vector: [0.99, 0.01],
      chunk: { ...sampleChunk, id: "prog-1", category: "programs", trustLevel: "community" },
      contentHash: "hash-program",
    });

    store.setInitialized(true);

    const tokenOnly = store.search([1.0, 0.0], { category: "token-security" });
    expect(tokenOnly.length).toBe(1);
    expect(tokenOnly[0].chunk.category).toBe("token-security");

    const authOnly = store.search([1.0, 0.0], { trustLevel: "authoritative" });
    expect(authOnly.length).toBe(1);
    expect(authOnly[0].chunk.id).toBe("token-chunk");
  });

  test("4. VectorStore persistence (saveToFile and loadFromFile)", () => {
    const store1 = new VectorStore();
    store1.addEntry({
      id: "persist-chunk",
      vector: [0.5, 0.5],
      chunk: sampleChunk,
      contentHash: "hash-persist",
    });
    store1.setInitialized(true);

    store1.saveToFile(tmpFile);
    expect(fs.existsSync(tmpFile)).toBe(true);

    const store2 = new VectorStore();
    const loaded = store2.loadFromFile(tmpFile);
    expect(loaded).toBe(true);
    expect(store2.count).toBe(1);
    expect(store2.getEntry("persist-chunk")?.chunk.title).toBe(sampleChunk.title);
  });

  test("5. Empty store returns empty array gracefully without throwing", () => {
    const emptyStore = new VectorStore();
    const results = emptyStore.search([1, 2, 3]);
    expect(results).toEqual([]);
  });
});
