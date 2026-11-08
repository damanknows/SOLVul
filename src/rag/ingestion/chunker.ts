// src/rag/ingestion/chunker.ts
import type { RawKnowledgeDocument, KnowledgeChunk } from "../types";
import { createKnowledgeChunk } from "./metadata";

export interface ChunkerOptions {
  maxChunkSize?: number;
  minChunkSize?: number;
}

/**
 * Splits a RawKnowledgeDocument into structured KnowledgeChunks.
 * Uses markdown headings (##, ###) as natural section boundaries.
 */
export function chunkDocument(
  doc: RawKnowledgeDocument,
  options: ChunkerOptions = {},
): KnowledgeChunk[] {
  const maxChunkSize = options.maxChunkSize || 1200;
  const minChunkSize = options.minChunkSize !== undefined ? options.minChunkSize : 20;

  const chunks: KnowledgeChunk[] = [];
  const lines = doc.content.split(/\r?\n/);

  let currentSection = doc.title;
  let currentBuffer: string[] = [];
  let chunkIndex = 0;

  function flushBuffer() {
    const text = currentBuffer.join("\n").trim();
    if (text.length >= minChunkSize) {
      chunks.push(
        createKnowledgeChunk({
          documentId: doc.id,
          chunkIndex: chunkIndex++,
          title: doc.title,
          sourceUrl: doc.sourceUrl,
          publisher: doc.publisher,
          documentType: doc.documentType,
          category: doc.category,
          section: currentSection,
          content: text,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        }),
      );
    }
    currentBuffer = [];
  }

  for (const line of lines) {
    const headerMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headerMatch) {
      if (currentBuffer.length > 0) {
        flushBuffer();
      }
      currentSection = headerMatch[1].trim();
      currentBuffer.push(line);
      continue;
    }

    currentBuffer.push(line);

    // If buffer exceeds max size and line is blank, flush
    const currentLen = currentBuffer.reduce((acc, l) => acc + l.length + 1, 0);
    if (currentLen >= maxChunkSize && line.trim() === "") {
      flushBuffer();
    }
  }

  if (currentBuffer.length > 0) {
    flushBuffer();
  }

  // If content was smaller than minChunkSize, ensure at least one chunk exists if non-empty
  if (chunks.length === 0 && doc.content.trim().length > 0) {
    chunks.push(
      createKnowledgeChunk({
        documentId: doc.id,
        chunkIndex: 0,
        title: doc.title,
        sourceUrl: doc.sourceUrl,
        publisher: doc.publisher,
        documentType: doc.documentType,
        category: doc.category,
        section: doc.title,
        content: doc.content.trim(),
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      }),
    );
  }

  return chunks;
}
