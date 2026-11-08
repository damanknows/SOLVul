// src/lib/env.ts
import { z } from "zod";

/**
 * Environment variables schema for SOLVul.
 *
 * Server-only variables (never exposed with NEXT_PUBLIC_):
 * - `GEMINI_API_KEY`: Server-side API key for Google Gemini.
 * - `GEMINI_MODEL`: Configurable Gemini model (default: "gemini-2.5-flash").
 *
 * Public/RPC variables:
 * - `NEXT_PUBLIC_API_URL`: Base URL for the internal API.
 * - `SOLANA_RPC_ENDPOINT`: Solana RPC node URL (default: Devnet).
 */
export const envSchema = z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:3000"),
  SOLANA_RPC_ENDPOINT: z.string().url().default("https://api.devnet.solana.com"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.5-flash"),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Validated environment configuration with sensible defaults.
 */
export const env: Env = envSchema.parse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000",
  SOLANA_RPC_ENDPOINT: process.env.SOLANA_RPC_ENDPOINT || "https://api.devnet.solana.com",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-3.5-flash",
});

/**
 * Validate that server has GEMINI_API_KEY configured.
 * Throws a clear error if missing.
 */
export function validateServerGeminiConfig(): { apiKey: string; model: string } {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is missing. Please configure GEMINI_API_KEY in your server environment or .env file.",
    );
  }
  return {
    apiKey,
    model: process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash",
  };
}
