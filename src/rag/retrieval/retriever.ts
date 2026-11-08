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
  public lexicalFallbackUsed: boolean = false;

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
    this.lexicalFallbackUsed = false;
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
      let queryVector: number[] | null = null;
      try {
        queryVector = await this.embeddingService.generateEmbedding(query.text);
      } catch {
        // Embedding failed: trigger lexical keyword search fallback
        this.lexicalFallbackUsed = true;
      }

      if (queryVector) {
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
      } else {
        // Lexical keyword search fallback across indexed chunks
        const queryTerms = query.text.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
        for (const entry of this.vectorStore.getAllEntries()) {
          if (query.category && entry.chunk.category !== query.category) continue;
          const contentLower = `${entry.chunk.title} ${entry.chunk.section || ""} ${entry.chunk.content}`.toLowerCase();
          let matchCount = 0;
          for (const term of queryTerms) {
            if (contentLower.includes(term)) {
              matchCount++;
            }
          }
          if (matchCount > 0) {
            const lexicalScore = Math.min(0.95, 0.65 + (matchCount / queryTerms.length) * 0.25);
            if (lexicalScore >= minScore * 0.9) {
              allScored.push({
                chunk: entry.chunk,
                relevanceScore: Number(lexicalScore.toFixed(3)),
                findingId: query.findingId,
              });
            }
          }
        }
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

    // Formulate truthful summary without overclaiming authority for unverified/community sources
    const authCount = filtered.filter((f) => f.chunk.trustLevel === "authoritative").length;
    let summary: string;
    if (authCount === filtered.length) {
      summary = `Retrieved ${filtered.length} authoritative security evidence document(s).`;
    } else if (authCount > 0) {
      summary = `Retrieved ${filtered.length} security evidence document(s) (${authCount} authoritative).`;
    } else {
      summary = `Retrieved ${filtered.length} security evidence document(s) (community/research sources).`;
    }

    return {
      evidence,
      allRetrieved: filtered,
      summary,
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
