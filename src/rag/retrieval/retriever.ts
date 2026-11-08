// src/rag/retrieval/retriever.ts
import type {
  FindingEvidence,
  ScoredChunk,
  RAGPipelineResult,
  KnowledgeChunk,
} from "../types";
import { VectorStore, getGlobalVectorStore } from "../storage/vectorStore";
import { IEmbeddingService, getEmbeddingService } from "../embeddings/embeddingService";
import { getRAGConfig, RAGConfig } from "../config";
import { buildQueriesForFindings } from "./queryBuilder";
import { filterAndRankChunks, mapChunksToFindingEvidence } from "./relevance";
import type { DecodedTransaction } from "../../solana/transactionDecoder";
import type { FindingBreakdown } from "../../solana/transactionRiskScore";

export class SecurityKnowledgeRetriever {
  private vectorStore: VectorStore;
  private embeddingService: IEmbeddingService;
  private config: RAGConfig;

  constructor(
    vectorStore?: VectorStore,
    embeddingService?: IEmbeddingService,
    config?: RAGConfig,
  ) {
    this.vectorStore = vectorStore || getGlobalVectorStore();
    this.embeddingService = embeddingService || getEmbeddingService();
    this.config = config || getRAGConfig();
  }

  /**
   * Retrieves evidence-backed security documentation tailored specifically
   * to deterministic STRS findings, transaction instructions, and simulation evidence.
   */
  public async retrieveForTransaction(
    decoded?: DecodedTransaction,
    findings: FindingBreakdown[] = [],
    overrideMinScore?: number,
    simulation?: any,
  ): Promise<RAGPipelineResult> {
    const minScore = overrideMinScore !== undefined ? overrideMinScore : this.config.minRelevanceScore;
    const queries = buildQueriesForFindings(findings, decoded, simulation);

    if (queries.length === 0 || this.vectorStore.count === 0) {
      return {
        evidence: [],
        allRetrieved: [],
        summary: "No sufficiently relevant security documentation found.",
        hasResults: false,
        missingEvidenceNotice: "No sufficiently relevant security documentation found.",
      };
    }

    const allScored: ScoredChunk[] = [];

    for (const query of queries) {
      try {
        const queryVector = await this.embeddingService.generateEmbedding(query.text);
        const matches = this.vectorStore.search(queryVector, {
          topK: 2,
          minScore: minScore * 0.9, // slightly relaxed before final ranking
          category: query.category,
        });

        for (const match of matches) {
          allScored.push({
            chunk: match.chunk,
            relevanceScore: match.relevanceScore,
            findingId: query.findingId,
          });
        }
      } catch {
        // Continue querying remaining findings if one embedding call fails
      }
    }

    const filtered = filterAndRankChunks(allScored, {
      minScore,
      topK: this.config.topK,
      deduplicateByDocument: true,
    });

    if (filtered.length === 0) {
      return {
        evidence: [],
        allRetrieved: [],
        summary: "No sufficiently relevant security documentation found.",
        hasResults: false,
        missingEvidenceNotice: "No sufficiently relevant security documentation found.",
      };
    }

    const evidence = mapChunksToFindingEvidence(filtered);

    return {
      evidence,
      allRetrieved: filtered,
      summary: `Retrieved ${filtered.length} authoritative security evidence document(s).`,
      hasResults: true,
    };
  }
}

// Global default retriever instance
let defaultRetriever: SecurityKnowledgeRetriever | null = null;

export function getDefaultRetriever(): SecurityKnowledgeRetriever {
  if (!defaultRetriever) {
    defaultRetriever = new SecurityKnowledgeRetriever();
  }
  return defaultRetriever;
}

export function setDefaultRetriever(retriever: SecurityKnowledgeRetriever): void {
  defaultRetriever = retriever;
}
