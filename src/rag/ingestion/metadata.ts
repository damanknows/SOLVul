// src/rag/ingestion/metadata.ts
import crypto from "crypto";
import type { KnowledgeChunk, RawKnowledgeDocument, DocumentCategory, DocumentType, TrustLevel } from "../types";
import { validateDocumentProvenance } from "../security/provenance";

export interface ChunkMetadataInput {
  documentId: string;
  chunkIndex: number;
  title: string;
  sourceUrl?: string;
  publisher?: string;
  documentType: DocumentType;
  category: DocumentCategory;
  section?: string;
  content: string;
  createdAt?: string;
  updatedAt?: string;
}

export function createKnowledgeChunk(input: ChunkMetadataInput): KnowledgeChunk {
  const trustLevel = validateDocumentProvenance({
    title: input.title,
    sourceUrl: input.sourceUrl,
    publisher: input.publisher,
    documentType: input.documentType,
  });

  const stableId = `chunk-${input.documentId}-${input.chunkIndex}`;

  return {
    id: stableId,
    documentId: input.documentId,
    title: input.title,
    sourceUrl: input.sourceUrl,
    publisher: input.publisher,
    documentType: input.documentType,
    category: input.category,
    section: input.section,
    content: input.content.trim(),
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: input.updatedAt,
    ingestedAt: new Date().toISOString(),
    trustLevel,
  };
}

/**
 * Parses simple YAML frontmatter block from markdown string.
 */
export function parseFrontmatter(markdown: string): {
  metadata: Record<string, string>;
  body: string;
} {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { metadata: {}, body: markdown };
  }

  const frontmatterStr = match[1];
  const body = match[2];
  const metadata: Record<string, string> = {};

  const lines = frontmatterStr.split(/\r?\n/);
  for (const line of lines) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      let val = line.slice(colonIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      metadata[key] = val;
    }
  }

  return { metadata, body };
}
