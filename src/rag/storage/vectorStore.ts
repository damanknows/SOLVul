// src/rag/storage/vectorStore.ts
import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { VectorEntry, KnowledgeChunk, ScoredChunk } from "../types";

/**
 * Computes cosine similarity between two numeric vectors.
 * Returns a score between -1 and 1 (or 0 to 1 for non-negative vectors).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || b.length === 0 || a.length !== b.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Generates a SHA-256 hash for deduplication.
 */
export function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content.trim()).digest("hex");
}

export interface VectorSearchOptions {
  topK?: number;
  minScore?: number;
  category?: string;
  trustLevel?: string;
}

export class VectorStore {
  private entries: Map<string, VectorEntry> = new Map();
  private hashes: Set<string> = new Set();
  private _initialized: boolean = false;

  constructor(entries?: VectorEntry[]) {
    if (entries && entries.length > 0) {
      for (const entry of entries) {
        this.addEntry(entry);
      }
      this._initialized = true;
    }
  }

  public get isInitialized(): boolean {
    return this._initialized;
  }

  public setInitialized(val: boolean = true): void {
    this._initialized = val;
  }

  public get count(): number {
    return this.entries.size;
  }

  /**
   * Adds a vector entry. Ignores duplicates if content hash already exists.
   * Returns true if entry was added, false if it was a duplicate.
   */
  public addEntry(entry: VectorEntry): boolean {
    if (!entry.contentHash) {
      entry.contentHash = hashContent(entry.chunk.content);
    }

    if (this.hashes.has(entry.contentHash)) {
      return false;
    }

    this.entries.set(entry.id, entry);
    this.hashes.add(entry.contentHash);
    return true;
  }

  public getEntry(id: string): VectorEntry | undefined {
    return this.entries.get(id);
  }

  public getAllEntries(): VectorEntry[] {
    return Array.from(this.entries.values());
  }

  public hasContentHash(hash: string): boolean {
    return this.hashes.has(hash);
  }

  /**
   * Searches the vector store using cosine similarity with optional metadata filtering.
   */
  public search(queryVector: number[], options: VectorSearchOptions = {}): ScoredChunk[] {
    if (!this._initialized && this.entries.size === 0) {
      return [];
    }

    const { topK = 4, minScore = 0.0, category, trustLevel } = options;

    const scored: ScoredChunk[] = [];

    for (const entry of this.entries.values()) {
      if (category && entry.chunk.category !== category) {
        continue;
      }
      if (trustLevel && entry.chunk.trustLevel !== trustLevel) {
        continue;
      }

      const score = cosineSimilarity(queryVector, entry.vector);
      if (score >= minScore) {
        scored.push({
          chunk: entry.chunk,
          relevanceScore: Math.round(score * 1000) / 1000,
        });
      }
    }

    // Sort descending by relevance score
    scored.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return scored.slice(0, Math.max(1, topK));
  }

  /**
   * Saves the vector store contents to a JSON file.
   */
  public saveToFile(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const data = {
      version: "1.0",
      savedAt: new Date().toISOString(),
      count: this.entries.size,
      entries: Array.from(this.entries.values()),
    };

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  }

  /**
   * Loads the vector store contents from a JSON file.
   */
  public loadFromFile(filePath: string): boolean {
    if (!fs.existsSync(filePath)) {
      return false;
    }

    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const data = JSON.parse(raw);
      if (Array.isArray(data.entries)) {
        this.clear();
        for (const entry of data.entries) {
          this.addEntry(entry);
        }
        this._initialized = true;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  public clear(): void {
    this.entries.clear();
    this.hashes.clear();
    this._initialized = false;
  }
}

// Global persistent singleton instance
let globalVectorStore: VectorStore | null = null;

export function getGlobalVectorStore(): VectorStore {
  if (!globalVectorStore) {
    globalVectorStore = new VectorStore();
  }
  return globalVectorStore;
}

export function setGlobalVectorStore(store: VectorStore): void {
  globalVectorStore = store;
}
