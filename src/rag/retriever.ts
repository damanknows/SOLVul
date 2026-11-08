// src/rag/retriever.ts
/**
 * RAG Retriever for Solana Transaction Security Knowledge Base.
 * Provides deterministic evidence retrieval from the security corpus
 * to support STRS findings and Gemini-style explanations.
 */

export interface Chunk {
  id: string;
  source: string;
  uri: string;
  content: string;
  tags?: string[];
}

export interface RetrievalResult {
  chunk: Chunk;
  score: number;
}

export interface VectorStore {
  chunks: Chunk[];
}

/**
 * Built-in baseline Solana security knowledge corpus.
 * Contains authoritative guidance on common Solana attack vectors and patterns.
 */
export const SECURITY_CORPUS: Chunk[] = [
  {
    id: "sec-01",
    source: "Solana Security Guide",
    uri: "https://docs.solana.com/developing/programming-model/transactions#signatures",
    content:
      "Pre-sign firewalls inspect unsigned transactions before user authorization. A transaction lacking signatures is normal during pre-flight inspection and must not be penalized solely for being unsigned.",
    tags: ["unsigned", "pre-flight", "signatures"],
  },
  {
    id: "sec-02",
    source: "Solana SPL Token Documentation",
    uri: "https://spl.solana.com/token#authority-delegation",
    content:
      "Approve instruction delegates token transfer authority to a third-party address. Delegating large or unlimited amounts (u64::MAX) allows the delegate to drain the owner's token account at any future time without additional user approval.",
    tags: ["token", "approve", "delegate", "drain", "VS-05-APPROVE"],
  },
  {
    id: "sec-03",
    source: "Solana SPL Token Authority Reference",
    uri: "https://spl.solana.com/token#set-authority",
    content:
      "SetAuthority irrevocably reassigns ownership, mint, or freeze authority to a new public key. Malicious dApps frequently use SetAuthority to hijack control of token mints or token accounts.",
    tags: ["token", "set-authority", "hijack", "authority", "VS-06"],
  },
  {
    id: "sec-04",
    source: "Solana System Program Guide",
    uri: "https://docs.solana.com/developing/runtime-facilities/programs#system-program",
    content:
      "SystemProgram::Assign changes the program owner of an account. When an account owner is reassigned to an arbitrary program, that program obtains full write and debit authority over the account, effectively surrendering ownership.",
    tags: ["system", "assign", "reassignment", "ownership", "VS-06-ASSIGN"],
  },
  {
    id: "sec-05",
    source: "Solana Program Verification Guide",
    uri: "https://docs.solana.com/developing/on-chain-programs/overview",
    content:
      "Unverified program interaction indicates that the program ID is not among widely recognized ecosystem programs. An unverified program is not automatically malicious, but users must exercise caution and verify the source.",
    tags: ["unverified", "program", "unknown", "VS-02"],
  },
  {
    id: "sec-06",
    source: "Solana Transaction Simulation Manual",
    uri: "https://docs.solana.com/api/http#simulatetransaction",
    content:
      "Simulating transactions pre-flight allows verification of execution logs and compute units. However, simulation failure is not conclusive proof of malice (e.g. recent blockhash expiry, missing mock balances), and simulation success does not guarantee future execution on live chain.",
    tags: ["simulation", "simulate", "rpc", "VS-08-ERR"],
  },
  {
    id: "sec-07",
    source: "Solana SPL Token Account Lifecycle",
    uri: "https://spl.solana.com/token#close-account",
    content:
      "CloseAccount closes a token account and transfers its remaining rent lamports to a destination address. Ensure that the remaining lamport destination belongs to your wallet.",
    tags: ["close", "close-account", "token", "VS-07"],
  },
];

/**
 * Retrieve relevant chunks from the security knowledge store based on query terms or tags.
 * Falls back to built-in SECURITY_CORPUS if no custom store is provided.
 */
export async function retrieve(
  query: string,
  store?: VectorStore | any,
  topK: number = 3,
): Promise<RetrievalResult[]> {
  const chunks: Chunk[] =
    store && Array.isArray(store.chunks) && store.chunks.length > 0
      ? store.chunks
      : SECURITY_CORPUS;

  const normalizedQuery = query.toLowerCase().trim();
  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);

  const scored: RetrievalResult[] = chunks.map((chunk) => {
    let score = 0;
    const lowerContent = chunk.content.toLowerCase();
    const lowerSource = chunk.source.toLowerCase();

    for (const word of queryWords) {
      if (lowerContent.includes(word)) score += 2;
      if (lowerSource.includes(word)) score += 3;
      if (chunk.tags?.some((t) => t.toLowerCase().includes(word))) score += 4;
    }

    // Default base score for relevance if query is broad like "security"
    if (score === 0 && (normalizedQuery === "security" || normalizedQuery.length === 0)) {
      score = 1;
    }

    return { chunk, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(1, topK));
}

export default retrieve;
