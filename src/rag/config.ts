// src/rag/config.ts
import path from "path";

export interface RAGConfig {
  embeddingProvider: "google" | "local";
  embeddingModel: string;
  minRelevanceScore: number;
  topK: number;
  vectorStorePath: string;
  knowledgeDir: string;
  timeoutMs: number;
}

/**
 * Returns current RAG configuration resolved from environment variables with safe defaults.
 */
export function getRAGConfig(): RAGConfig {
  const provider = (process.env.RAG_EMBEDDING_PROVIDER?.toLowerCase() === "local" ? "local" : "google") as "google" | "local";
  const model = process.env.RAG_EMBEDDING_MODEL?.trim() || "gemini-embedding-001";
  const minScore = parseFloat(process.env.RAG_MIN_RELEVANCE_SCORE || "0.65");
  const topK = parseInt(process.env.RAG_TOP_K || "4", 10);
  const vectorStorePath =
    process.env.RAG_VECTOR_STORE_PATH?.trim() ||
    (process.env.RAG_VECTOR_STORE && process.env.RAG_VECTOR_STORE.includes(".json")
      ? process.env.RAG_VECTOR_STORE.trim()
      : path.join(process.cwd(), "data", "rag_vector_store.json"));
  const knowledgeDir = process.env.RAG_KNOWLEDGE_DIR?.trim() || path.join(process.cwd(), "knowledge");

  return {
    embeddingProvider: provider,
    embeddingModel: model,
    minRelevanceScore: Number.isFinite(minScore) && minScore >= 0 && minScore <= 1 ? minScore : 0.65,
    topK: Number.isFinite(topK) && topK > 0 ? topK : 4,
    vectorStorePath,
    knowledgeDir,
    timeoutMs: 10000,
  };
}
