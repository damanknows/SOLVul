// src/lib/env.ts
import { z } from "zod";

/**
 * Environment variables schema for Vulture‑SVM.
 *
 * - `NEXT_PUBLIC_API_URL` – Base URL for the internal API (required).
 * - `SOLANA_RPC_ENDPOINT` – Solana RPC node URL.
 * - `OPENAI_API_KEY` – API key for the LLM provider (optional for local model).
 */
export const envSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url(),
  SOLANA_RPC_ENDPOINT: z.string().url(),
  OPENAI_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validate `process.env` against the schema. Throws if validation fails.
 */
export const env: Env = envSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  SOLANA_RPC_ENDPOINT: process.env.SOLANA_RPC_ENDPOINT,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
});

