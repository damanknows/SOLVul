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
    <form onSubmit={handleSubmit} className="flex flex-col space-y-2 p-4 border rounded-md">
      <label className="font-medium">Base64 Serialized Unsigned Transaction</label>
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder="Enter base64 string…"
        rows={4}
        className="p-2 border rounded resize-none"
      />
      <button
        type="submit"
        className="px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
      >
        Validate Payload
      </button>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {decodedSize !== null && (
        <p className="text-green-600 text-sm">Valid payload – {decodedSize} bytes</p>
      )}
    </form>
  );
}

