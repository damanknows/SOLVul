// src/gemini/errors.ts
/**
 * Error hierarchy for Google Gemini Security Explanation Engine.
 */

export class GeminiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeminiError";
  }
}

/**
 * Thrown when Gemini API key or model configuration is missing or invalid.
 */
export class GeminiConfigError extends GeminiError {
  constructor(message: string = "GEMINI_API_KEY environment variable is not configured on the server") {
    super(message);
    this.name = "GeminiConfigError";
  }
}

/**
 * Thrown when an API call to Gemini fails (rate limits, timeouts, network errors, RPC aborts).
 */
export class GeminiApiError extends GeminiError {
  public statusCode?: number;
  public isRateLimit: boolean;
  public isTimeout: boolean;

  constructor(message: string, options?: { statusCode?: number; isRateLimit?: boolean; isTimeout?: boolean }) {
    super(message);
    this.name = "GeminiApiError";
    this.statusCode = options?.statusCode;
    this.isRateLimit = options?.isRateLimit ?? false;
    this.isTimeout = options?.isTimeout ?? false;
  }
}

/**
 * Thrown when the model's generated response cannot be parsed or fails Zod schema validation.
 */
export class GeminiValidationError extends GeminiError {
  public rawResponse?: string;

  constructor(message: string, rawResponse?: string) {
    super(message);
    this.name = "GeminiValidationError";
    this.rawResponse = rawResponse;
  }
}

/**
 * Thrown when input data provided to the explanation engine is invalid or malformed.
 */
export class GeminiInputError extends GeminiError {
  constructor(message: string) {
    super(message);
    this.name = "GeminiInputError";
  }
}
