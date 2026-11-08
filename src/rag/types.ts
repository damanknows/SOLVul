// src/rag/types.ts
/**
 * Core type definitions for SOLVul Solana Security RAG pipeline.
 */

export type DocumentCategory =
  | "solana"
  | "programs"
  | "token-security"
  | "transaction-security"
  | "anchor"
  | "audits";

export type DocumentType =
  | "official_docs"
  | "security_research"
  | "audit_report"
  | "runtime_spec"
  | "community";

export type TrustLevel = "authoritative" | "verified_research" | "community";

export interface KnowledgeChunk {
  id: string;
  documentId: string;
  title: string;
  sourceUrl?: string;
  publisher?: string;
  documentType: DocumentType;
  category: DocumentCategory;
  section?: string;
  content: string;
  createdAt: string;
  updatedAt?: string;
  ingestedAt: string;
  trustLevel: TrustLevel;
}

export interface RawKnowledgeDocument {
  id: string;
  title: string;
  sourceUrl?: string;
  publisher?: string;
  documentType: DocumentType;
  category: DocumentCategory;
  trustLevel: TrustLevel;
  createdAt: string;
  updatedAt?: string;
  content: string;
  sections?: Array<{
    title: string;
    content: string;
  }>;
}

export interface VectorEntry {
  id: string;
  vector: number[];
  chunk: KnowledgeChunk;
  contentHash: string;
}

export interface RetrievalQuery {
  findingId?: string;
  text: string;
  category?: DocumentCategory;
  tags?: string[];
  instructionType?: string;
  programId?: string;
}

export interface ScoredChunk {
  chunk: KnowledgeChunk;
  relevanceScore: number;
  findingId?: string;
}

export interface FindingEvidenceDocument {
  documentId: string;
  title: string;
  sourceUrl?: string;
  excerpt: string;
  relevanceScore: number;
  section?: string;
  trustLevel?: TrustLevel;
}

/**
 * Associates retrieved security knowledge chunks with the specific finding they support.
 */
export interface FindingEvidence {
  findingId: string;
  documents: FindingEvidenceDocument[];
}

export interface RAGPipelineResult {
  evidence: FindingEvidence[];
  allRetrieved: ScoredChunk[];
  summary: string;
  hasResults: boolean;
  missingEvidenceNotice?: string;
}
