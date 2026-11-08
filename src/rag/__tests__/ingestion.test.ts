// src/rag/__tests__/ingestion.test.ts
import path from "path";
import fs from "fs";
import { loadDocumentsFromDirectory, loadDocumentFromFile } from "../ingestion/documentLoader";
import { chunkDocument } from "../ingestion/chunker";
import { parseFrontmatter, createKnowledgeChunk } from "../ingestion/metadata";
import { IngestionPipeline } from "../ingestion/ingest";
import { VectorStore } from "../storage/vectorStore";
import { DocumentStore } from "../storage/documentStore";
import { LocalDeterministicEmbeddingService } from "../embeddings/embeddingService";
import type { RawKnowledgeDocument } from "../types";

describe("Phase 8 - RAG Document Ingestion & Chunking", () => {
  const knowledgeDir = path.join(process.cwd(), "knowledge");

  test("1. Successfully loads documents from knowledge directory", () => {
    const docs = loadDocumentsFromDirectory(knowledgeDir);
    expect(docs.length).toBeGreaterThanOrEqual(5);

    const categories = docs.map((d) => d.category);
    expect(categories).toContain("solana");
    expect(categories).toContain("programs");
    expect(categories).toContain("token-security");
    expect(categories).toContain("transaction-security");
  });

  test("2. Correctly parses YAML frontmatter and preserves metadata", () => {
    const md = `---
id: "test-doc"
title: "Test Security Doc"
sourceUrl: "https://solana.com/docs/security"
publisher: "Solana Foundation"
documentType: "official_docs"
category: "solana"
trustLevel: "authoritative"
createdAt: "2024-01-01T00:00:00Z"
---
# Main Section
This is body text.`;

    const { metadata, body } = parseFrontmatter(md);
    expect(metadata.id).toBe("test-doc");
    expect(metadata.title).toBe("Test Security Doc");
    expect(metadata.sourceUrl).toBe("https://solana.com/docs/security");
    expect(body.trim()).toBe("# Main Section\nThis is body text.");
  });

  test("3. Chunks documents at section headers and preserves document context", () => {
    const sampleDoc: RawKnowledgeDocument = {
      id: "doc-sample",
      title: "Sample Security Guide",
      sourceUrl: "https://solana.com/docs/sample",
      publisher: "Solana Foundation",
      documentType: "official_docs",
      category: "solana",
      trustLevel: "authoritative",
      createdAt: "2024-01-01T00:00:00Z",
      content: `# Overview
Introductory content about transactions.

## Section A
Detailed discussion about account reallocation and rent exemption.

## Section B
Detailed discussion about closing accounts and lamport extraction.`,
    };

    const chunks = chunkDocument(sampleDoc);
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    for (const chunk of chunks) {
      expect(chunk.documentId).toBe("doc-sample");
      expect(chunk.title).toBe("Sample Security Guide");
      expect(chunk.trustLevel).toBe("authoritative");
      expect(chunk.sourceUrl).toBe("https://solana.com/docs/sample");
      expect(chunk.id).toMatch(/^chunk-doc-sample-\d+$/);
    }
  });

  test("4. Duplicate ingestion detection skips unchanged chunks", async () => {
    const vectorStore = new VectorStore();
    const docStore = new DocumentStore();
    const embeddingService = new LocalDeterministicEmbeddingService();
    const pipeline = new IngestionPipeline(vectorStore, docStore, embeddingService);

    const doc: RawKnowledgeDocument = {
      id: "doc-dup",
      title: "Duplicate Test Doc",
      sourceUrl: "https://solana.com/docs",
      documentType: "official_docs",
      category: "solana",
      trustLevel: "authoritative",
      createdAt: "2024-01-01T00:00:00Z",
      content: "## Duplication Section\nDeterministic test payload for deduplication testing.",
    };

    const result1 = await pipeline.ingestDocuments([doc]);
    expect(result1.newChunksIngested).toBeGreaterThan(0);
    expect(result1.skippedDuplicates).toBe(0);

    // Re-ingest exact same document
    const result2 = await pipeline.ingestDocuments([doc]);
    expect(result2.newChunksIngested).toBe(0);
    expect(result2.skippedDuplicates).toBe(result1.newChunksIngested);
  });

  test("5. Handles empty knowledge corpus gracefully", async () => {
    const vectorStore = new VectorStore();
    const docStore = new DocumentStore();
    const embeddingService = new LocalDeterministicEmbeddingService();
    const pipeline = new IngestionPipeline(vectorStore, docStore, embeddingService);

    const result = await pipeline.ingestDocuments([]);
    expect(result.totalDocuments).toBe(0);
    expect(result.totalChunks).toBe(0);
    expect(result.newChunksIngested).toBe(0);
    expect(vectorStore.count).toBe(0);
  });
});
