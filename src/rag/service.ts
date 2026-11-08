// src/rag/service.ts
import { VectorStore, getGlobalVectorStore } from "./storage/vectorStore";
import { IngestionPipeline } from "./ingestion/ingest";
import { SecurityKnowledgeRetriever, getDefaultRetriever } from "./retrieval/retriever";
import { getEmbeddingService } from "./embeddings/embeddingService";
import { getRAGConfig } from "./config";
import type { DecodedTransaction } from "../solana/transactionDecoder";
import type { FindingBreakdown } from "../solana/transactionRiskScore";
import type { RAGPipelineResult } from "./types";

export interface RAGOperationalStatus {
  initialized: boolean;
  documentCount: number;
  chunkCount: number;
  embeddingProvider: string;
  embeddingModel: string;
  vectorStoreStatus: "ready" | "empty" | "error";
  lastIngestionError: string | null;
  lastRetrievalSuccess: boolean;
  lexicalFallbackUsed: boolean;
}

let initializationPromise: Promise<void> | null = null;
let lastIngestionError: string | null = null;
let lastRetrievalSuccess: boolean = false;
let lexicalFallbackUsed: boolean = false;

/**
 * Redacts secrets, API keys, and sensitive internal paths from error messages.
 */
export function sanitizeRAGErrorMessage(raw?: string | null): string | null {
  if (!raw) return null;
  return String(raw)
    .replace(/AIza[0-9A-Za-z-_]{35}/g, "[REDACTED_KEY]")
    .replace(/\/(home|Users|tmp|var|etc)\/[A-Za-z0-9_.\-\/]+/g, "[LOCAL_PATH]")
    .trim();
}

/**
 * Returns meaningful operational telemetry for the RAG engine without leaking secrets or system paths.
 */
export function getRAGStatus(): RAGOperationalStatus {
  const vectorStore = getGlobalVectorStore();
  const config = getRAGConfig();
  const retriever = getDefaultRetriever();

  let vectorStoreStatus: "ready" | "empty" | "error" = "empty";
  if (lastIngestionError && vectorStore.count === 0) {
    vectorStoreStatus = "error";
  } else if (vectorStore.isInitialized && vectorStore.count > 0) {
    vectorStoreStatus = "ready";
  } else if (vectorStore.isInitialized && vectorStore.count === 0) {
    vectorStoreStatus = "empty";
  }

  return {
    initialized: vectorStore.isInitialized,
    documentCount: vectorStore.documentCount,
    chunkCount: vectorStore.count,
    embeddingProvider: config.embeddingProvider,
    embeddingModel: config.embeddingModel,
    vectorStoreStatus,
    lastIngestionError: sanitizeRAGErrorMessage(lastIngestionError),
    lastRetrievalSuccess,
    lexicalFallbackUsed: retriever.lexicalFallbackUsed || lexicalFallbackUsed,
  };
}

export function setRAGIngestionError(err: string | null): void {
  lastIngestionError = err;
}

export function resetRAGStatusForTesting(): void {
  initializationPromise = null;
  lastIngestionError = null;
  lastRetrievalSuccess = false;
  lexicalFallbackUsed = false;
}

/**
 * Initializes the RAG system, loading persisted vectors or ingesting from knowledge files.
 * Does not silently swallow ingestion errors; records error state into operational status.
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
      try {
        const loaded = vectorStore.loadFromFile(config.vectorStorePath);
        if (loaded && vectorStore.count > 0) {
          lastIngestionError = null;
          return;
        }
      } catch (loadErr: any) {
        lastIngestionError = `Vector store load failure: ${loadErr?.message || "unreadable file"}`;
      }
    }

    // 2. If not loaded or empty, ingest from knowledge directory
    try {
      const embeddingService = getEmbeddingService();
      const pipeline = new IngestionPipeline(vectorStore, undefined, embeddingService);
      await pipeline.ingestDirectory(config.knowledgeDir);
      lastIngestionError = null;
    } catch (ingestErr: any) {
      lastIngestionError = `Ingestion failure: ${ingestErr?.message || "directory ingestion failed"}`;
      vectorStore.setInitialized(true);
    }
  })();

  return initializationPromise;
}

/**
 * Retrieves security knowledge evidence for a decoded transaction, its STRS findings, and simulation results.
 */
export async function getSecurityEvidenceForTransaction(
  decoded?: DecodedTransaction,
  findings: FindingBreakdown[] = [],
  simulation?: any,
): Promise<RAGPipelineResult> {
  const vectorStore = getGlobalVectorStore();

  if (!vectorStore.isInitialized || vectorStore.count === 0) {
    await initializeRAG();
  }

  const retriever = getDefaultRetriever();
  try {
    const result = await retriever.retrieveForTransaction(decoded, findings, undefined, simulation);
    lastRetrievalSuccess = result.hasResults;
    lexicalFallbackUsed = retriever.lexicalFallbackUsed;
    return result;
  } catch (err: any) {
    lastRetrievalSuccess = false;
    throw err;
  }
}
