// src/web/components/TransactionInput.tsx
import { useState } from "react";

/**
 * Accepts a base64‑encoded unsigned Solana transaction.
 * Performs lightweight validation:
 *   • Must be valid base64.
 *   • Decoded byte length must be > 0 and <= MAX_SIZE.
 *   • Does **not** sign or broadcast the transaction.
 */
export default function TransactionInput() {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [decodedSize, setDecodedSize] = useState<number | null>(null);

  const MAX_SIZE = 1024; // 1 KB limit for an unsigned transaction payload

  const validate = (value: string) => {
    try {
      // atob works in browsers; Buffer works in Node (e.g., during tests)
      const binary = typeof window !== "undefined"
        ? Uint8Array.from(atob(value), c => c.charCodeAt(0))
        : Buffer.from(value, "base64");

      if (binary.length === 0) throw new Error("Decoded payload is empty");
      if (binary.length > MAX_SIZE) throw new Error(`Payload exceeds ${MAX_SIZE} bytes`);

      setDecodedSize(binary.length);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "Invalid base64 payload");
      setDecodedSize(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    validate(input.trim());
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col space-y-3 p-4 bg-slate-50 border border-slate-200 rounded-xl">
      <label className="text-xs font-bold text-slate-700">Base64 Serialized Unsigned Transaction</label>
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder="Enter base64 string…"
        rows={4}
        className="p-3 border border-slate-300 rounded-lg font-mono text-xs bg-white resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
      <button
        type="submit"
        className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-700 text-white text-xs sm:text-sm font-semibold rounded-lg shadow-xs transition-colors"
      >
        Validate Payload
      </button>
      {error && <p className="text-red-600 text-xs font-semibold bg-red-50 p-2 rounded border border-red-200">{error}</p>}
      {decodedSize !== null && (
        <p className="text-emerald-700 text-xs font-semibold bg-emerald-50 p-2 rounded border border-emerald-200">
          ✓ Valid payload – {decodedSize} bytes
        </p>
      )}
    </form>
  );
}
