// src/web/utils/crypto.ts
/**
 * Simple SHA‑256 helper that works in both Node and the browser.
 * Returns a hex string.
 */
export async function sha256(data: Uint8Array | Buffer): Promise<string> {
  if (typeof window !== "undefined" && (window as any).crypto?.subtle) {
    const hash = await (window as any).crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(hash);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  } else {
    // Node.js fallback
    const { createHash } = await import("crypto");
    return createHash("sha256").update(data).digest("hex");
  }
}

