// src/rag/service.ts
import { VectorStore, getGlobalVectorStore } from "./storage/vectorStore";
import { IngestionPipeline } from "./ingestion/ingest";
import { SecurityKnowledgeRetriever, getDefaultRetriever } from "./retrieval/retriever";
import { getEmbeddingService } from "./embeddings/embeddingService";
import { getRAGConfig } from "./config";
import type { DecodedTransaction } from "../solana/transactionDecoder";
import type { FindingBreakdown } from "../solana/transactionRiskScore";
import type { RAGPipelineResult } from "./types";

let initializationPromise: Promise<void> | null = null;

/**
 * Initializes the RAG system, loading persisted vectors or ingesting from knowledge files.
 */
export async function initializeRAG(): Promise<void> {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    const vectorStore = getGlobalVectorStore();
    const config = getRAGConfig();

    // 1. Try loading from cache file
    if (config.vectorStorePath) {
      const loaded = vectorStore.loadFromFile(config.vectorStorePath);
      if (loaded && vectorStore.count > 0) {
        return;
      }
    }

    // 2. If not loaded or empty, ingest from knowledge directory
    try {
      const embeddingService = getEmbeddingService();
      const pipeline = new IngestionPipeline(vectorStore, undefined, embeddingService);
      await pipeline.ingestDirectory(config.knowledgeDir);
    } catch {
      // If ingestion fails (e.g. offline during build), vector store will remain initialized with available chunks
      vectorStore.setInitialized(true);
    }
  })();

  return initializationPromise;
}

/**
 * Retrieves security knowledge evidence for a decoded transaction and its STRS findings.
 */
export async function getSecurityEvidenceForTransaction(
  decoded?: DecodedTransaction,
  findings: FindingBreakdown[] = [],
): Promise<RAGPipelineResult> {
  const vectorStore = getGlobalVectorStore();

  if (!vectorStore.isInitialized || vectorStore.count === 0) {
    await initializeRAG();
  }

  const retriever = getDefaultRetriever();
  return retriever.retrieveForTransaction(decoded, findings);
}
