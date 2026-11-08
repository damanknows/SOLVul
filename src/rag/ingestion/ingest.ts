// src/rag/ingestion/ingest.ts
import path from "path";
import type { RawKnowledgeDocument, KnowledgeChunk, VectorEntry } from "../types";
import { loadDocumentsFromDirectory } from "./documentLoader";
import { chunkDocument } from "./chunker";
import { VectorStore, hashContent, getGlobalVectorStore } from "../storage/vectorStore";
import { DocumentStore } from "../storage/documentStore";
import { IEmbeddingService, getEmbeddingService } from "../embeddings/embeddingService";
import { getRAGConfig } from "../config";

export interface IngestionResult {
  totalDocuments: number;
  totalChunks: number;
  newChunksIngested: number;
  skippedDuplicates: number;
  durationMs: number;
}

export class IngestionPipeline {
  private vectorStore: VectorStore;
  private documentStore: DocumentStore;
  private embeddingService: IEmbeddingService;

  constructor(
    vectorStore?: VectorStore,
    documentStore?: DocumentStore,
    embeddingService?: IEmbeddingService,
  ) {
    this.vectorStore = vectorStore || getGlobalVectorStore();
    this.documentStore = documentStore || new DocumentStore();
    this.embeddingService = embeddingService || getEmbeddingService();
  }

  /**
   * Ingests documents from the knowledge directory into the vector store.
   */
  public async ingestDirectory(dirPath?: string): Promise<IngestionResult> {
    const startTime = Date.now();
    const config = getRAGConfig();
    const targetDir = dirPath || config.knowledgeDir;

    const documents = loadDocumentsFromDirectory(targetDir);
    return this.ingestDocuments(documents);
  }

  /**
   * Ingests an array of RawKnowledgeDocuments.
   */
  public async ingestDocuments(documents: RawKnowledgeDocument[]): Promise<IngestionResult> {
    const startTime = Date.now();
    let totalChunks = 0;
    let newChunksIngested = 0;
    let skippedDuplicates = 0;

    const pendingChunks: KnowledgeChunk[] = [];
    const pendingHashes: string[] = [];

    for (const doc of documents) {
      this.documentStore.addDocument(doc);
      const chunks = chunkDocument(doc);
      totalChunks += chunks.length;

      for (const chunk of chunks) {
        const hash = hashContent(chunk.content);
        if (chunk.contentHash && chunk.contentHash.toLowerCase() !== hash.toLowerCase()) {
          // Reject chunk with mismatched/corrupted content hash
          continue;
        }
        chunk.contentHash = hash;

        if (this.vectorStore.hasContentHash(hash)) {
          skippedDuplicates++;
          continue;
        }

        pendingChunks.push(chunk);
        pendingHashes.push(hash);
      }
    }

    // Batch embed new chunks
    if (pendingChunks.length > 0) {
      const textsToEmbed = pendingChunks.map(
        (c) => `${c.title} - ${c.section || ""}\n${c.content}`,
      );

      const vectors = await this.embeddingService.generateEmbeddings(textsToEmbed);

      for (let i = 0; i < pendingChunks.length; i++) {
        const chunk = pendingChunks[i];
        const vector = vectors[i];
        const hash = pendingHashes[i];

        const entry: VectorEntry = {
          id: chunk.id,
          vector,
          chunk,
          contentHash: hash,
        };

        const added = this.vectorStore.addEntry(entry);
        if (added) {
          newChunksIngested++;
        }
      }

      this.vectorStore.setInitialized(true);
    } else if (this.vectorStore.count > 0) {
      this.vectorStore.setInitialized(true);
    }

    // Persist to disk if path is configured
    try {
      const config = getRAGConfig();
      if (config.vectorStorePath && newChunksIngested > 0) {
        this.vectorStore.saveToFile(config.vectorStorePath);
      }
    } catch {
      // Non-fatal if filesystem persistence fails in restricted environments
    }

    return {
      totalDocuments: documents.length,
      totalChunks,
      newChunksIngested,
      skippedDuplicates,
      durationMs: Date.now() - startTime,
    };
  }
}
