// src/gemini/client.ts
import { GoogleGenAI } from "@google/genai";
import { GeminiConfigError } from "./errors";

/**
 * Default Gemini model if not specified in environment.
 * Configurable via GEMINI_MODEL env var without code changes.
 */
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/**
 * Retrieve the active Gemini model name from environment or fallback.
 */
export function getGeminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
}

/**
 * Server-only factory for GoogleGenAI client.
 *
 * Guarantees:
 * 1. Fails immediately if executed on the client (browser).
 * 2. Never leaks the API key to client bundles or error stacks.
 * 3. Validates that GEMINI_API_KEY is present and non-empty.
 */
export function getGeminiClient(customApiKey?: string): GoogleGenAI {
  if (typeof window !== "undefined") {
    throw new Error("Security Violation: Gemini client cannot be initialized in client-side code");
  }

  const apiKey = (customApiKey || process.env.GEMINI_API_KEY)?.trim();

  if (!apiKey) {
    throw new GeminiConfigError(
      "GEMINI_API_KEY is not configured. Set GEMINI_API_KEY in your server environment or .env file.",
    );
  }

  return new GoogleGenAI({ apiKey });
}

export default getGeminiClient;
