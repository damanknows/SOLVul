// src/rag/embeddings/embeddingService.ts
import { GoogleGenAI } from "@google/genai";
import { getGeminiClient } from "../../gemini/client";
import { getRAGConfig } from "../config";

export interface IEmbeddingService {
  providerName: string;
  modelName: string;
  dimension: number;
  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
}

/**
 * Real Google GenAI Embedding Provider using @google/genai and gemini-embedding-001.
 */
export class GoogleEmbeddingService implements IEmbeddingService {
  public providerName = "google";
  public modelName: string;
  public dimension = 3072;
  private client: GoogleGenAI;

  constructor(modelName?: string, client?: GoogleGenAI) {
    if (typeof window !== "undefined" && !process.env.JEST_WORKER_ID) {
      throw new Error("GoogleEmbeddingService must only be instantiated server-side.");
    }
    this.modelName = modelName || getRAGConfig().embeddingModel;
    this.client = client || getGeminiClient();
  }

  public async generateEmbedding(text: string): Promise<number[]> {
    const results = await this.generateEmbeddings([text]);
    if (!results[0] || results[0].length === 0) {
      throw new Error("Google GenAI returned empty embedding values.");
    }
    return results[0];
  }

  public async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];

    // Filter and sanitize input
    const cleanTexts = texts.map((t) => t.trim() || "solana");

    try {
      // @google/genai embedContent supports string or array of strings
      const response = await this.client.models.embedContent({
        model: this.modelName,
        contents: cleanTexts,
      });

      const embeddings = (response as any).embeddings;
      if (!Array.isArray(embeddings) || embeddings.length === 0) {
        throw new Error("No embeddings array returned by Google GenAI embedContent.");
      }

      return embeddings.map((e: any, idx: number) => {
        if (!e.values || !Array.isArray(e.values)) {
          throw new Error(`Invalid embedding vector at index ${idx}`);
        }
        return e.values as number[];
      });
    } catch (err: any) {
      throw new Error(`GoogleEmbeddingService failure (${this.modelName}): ${err?.message || String(err)}`);
    }
  }
}

/**
 * Deterministic local feature-hash embedding service.
 * Used for offline mode, unit tests, and CI without external API dependencies.
 * Uses deterministic Murmur/FNV hashing across n-grams to produce normalized unit vectors.
 */
export class LocalDeterministicEmbeddingService implements IEmbeddingService {
  public providerName = "local";
  public modelName = "local-deterministic-hash-128";
  public dimension = 128;

  public async generateEmbedding(text: string): Promise<number[]> {
    return this.embedSingle(text);
  }

  public async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedSingle(t));
  }

  private embedSingle(text: string): number[] {
    const vector = new Array<number>(this.dimension).fill(0);
    const tokens = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1);

    if (tokens.length === 0) {
      vector[0] = 1.0;
      return vector;
    }

    // Unigrams and bigrams
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const bucket = this.hashString(token) % this.dimension;
      vector[bucket] += 1.0;

      if (i < tokens.length - 1) {
        const bigram = `${token}_${tokens[i + 1]}`;
        const bigramBucket = this.hashString(bigram) % this.dimension;
        vector[bigramBucket] += 1.5;
      }
    }

    // Normalize to unit vector
    let norm = 0;
    for (let i = 0; i < this.dimension; i++) {
      norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < this.dimension; i++) {
        vector[i] = vector[i] / norm;
      }
    }

    return vector;
  }

  private hashString(str: string): number {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash);
  }
}

/**
 * Returns an embedding service instance according to environment or fallback.
 */
export function getEmbeddingService(forceProvider?: "google" | "local"): IEmbeddingService {
  const config = getRAGConfig();
  const provider = forceProvider || config.embeddingProvider;

  if (provider === "google") {
    try {
      return new GoogleEmbeddingService(config.embeddingModel);
    } catch {
      // Fallback to local deterministic if GEMINI_API_KEY is not set
      return new LocalDeterministicEmbeddingService();
    }
  }

  return new LocalDeterministicEmbeddingService();
}
