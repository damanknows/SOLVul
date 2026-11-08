# SOLVul — Solana Pre-Sign Transaction Security Firewall

SOLVul is an open-source, evidence-based pre-flight transaction firewall and security explanation engine for Solana. It inspects unsigned Solana transactions (both Legacy and Versioned v0), decodes system and token operations, computes a deterministic **Solana Transaction Risk Score (STRS)**, retrieves evidence-backed security documentation via a specialized **Solana Security RAG Pipeline**, and presents clear explanations and signing recommendations using **Google Gemini**.

---

## Architecture Overview

```text
Unsigned Transaction Payload (Base64)
                 │
                 ▼
     ┌───────────────────────┐
     │  Transaction Decoder  │  (v0 / Legacy, ALTs, Token & Token-2022)
     └───────────┬───────────┘
                 │
                 ▼
     ┌───────────────────────┐
     │   STRS Deterministic  │  (Authoritative Risk Scoring & Findings)
     │      Risk Engine      │  (VS-01 to VS-08: Transfer, Approve, Assign, etc.)
     └───────────┬───────────┘
                 │
                 ▼
     ┌───────────────────────┐
     │   Solana Security RAG │  (Finds matching authoritative docs for each finding)
     │        Pipeline       │  (Vector similarity search, Provenance, Untrusted content sanitization)
     └───────────┬───────────┘
                 │
                 ▼
     ┌───────────────────────┐
     │ Google Gemini Service │  (Server-only, prompt-injection resistant explanation engine)
     └───────────┬───────────┘
                 │
                 ▼
     ┌───────────────────────┐
     │   Inspector UI Card   │  (Findings, RAG Evidence, Balance Deltas, Action Recommendation)
     └───────────────────────┘
```

---

## Solana Security RAG Pipeline (Phase 8)

The RAG pipeline operates independently of deterministic STRS risk scoring to provide evidence-backed context and citations to the Gemini explanation engine and UI.

### 1. Architecture & Directory Layout

```text
src/rag/
├── config.ts                    # RAG environment and hyperparameter configuration
├── types.ts                     # Core contracts (KnowledgeChunk, FindingEvidence, VectorEntry)
├── service.ts                   # RAG service singleton & lifecycle management
├── retriever.ts                 # Top-level API and backward-compatible retrieve() export
│
├── embeddings/
│   └── embeddingService.ts      # Google GenAI (gemini-embedding-001) & Local deterministic hash fallback
│
├── storage/
│   ├── vectorStore.ts           # Persistent vector database with cosine similarity & metadata filtering
│   └── documentStore.ts         # In-memory document storage
│
├── ingestion/
│   ├── metadata.ts              # YAML frontmatter parser and chunk metadata builder
│   ├── chunker.ts               # Markdown semantic header chunker with context preservation
│   ├── documentLoader.ts        # Recursive document loader for knowledge directories
│   └── ingest.ts                # Ingestion orchestrator with content-hash deduplication
│
├── retrieval/
│   ├── queryBuilder.ts          # STRS finding-to-semantic query builder
│   ├── relevance.ts             # Threshold filtering, score ranking, and evidence-to-finding grouping
│   └── retriever.ts             # Multi-query execution & honest "no evidence" reporting
│
└── security/
    ├── provenance.ts            # Trusted domain verification & trustLevel enforcement
    └── untrustedContent.ts      # Prompt-injection sanitizer and control-character stripper

knowledge/
├── solana/                      # System Program, transaction signatures & pre-flight firewall specs
├── programs/                    # Program verification, known ecosystem registries, Memo program
├── token-security/              # SPL Token Approve drains, SetAuthority hijacks, Token-2022 extensions
└── transaction-security/        # Simulation limitations, prompt injection defenses
```

### 2. Supported Document Formats & Metadata

Knowledge documents are stored as Markdown files with YAML frontmatter or JSON files:

```markdown
---
id: "token-spl-delegation"
title: "SPL Token Approve & Delegation Drain Vulnerability"
sourceUrl: "https://spl.solana.com/token#authority-delegation"
publisher: "Solana Program Library"
documentType: "official_docs"
category: "token-security"
trustLevel: "authoritative"
createdAt: "2024-01-20T00:00:00Z"
---

# SPL Token Delegation & Approve Instruction
The Approve instruction delegates transfer authority up to a specified maximum amount...
```

**Metadata Fields**:
- `id`: Stable document identifier.
- `title`: Human-readable title of the document.
- `sourceUrl`: Canonical reference URL (must belong to verified domains for authoritative status).
- `publisher`: Document publisher (e.g., Solana Foundation, Solana Program Library).
- `documentType`: `official_docs` | `security_research` | `audit_report` | `runtime_spec` | `community`.
- `category`: `solana` | `programs` | `token-security` | `transaction-security`.
- `trustLevel`: `authoritative` | `verified_research` | `community`.

### 3. Source Policy & Provenance Verification

Documents are classified into three trust tiers:
1. **`authoritative`**: Official specifications from verified domains (`solana.com`, `spl.solana.com`, `anchor-lang.com`).
2. **`verified_research`**: Independent security audit reports and published vulnerability research from recognized security firms (Neodyme, OtterSec, Sec3).
3. **`community`**: Informational community guides and unverified articles.

> **Clarification Guard**: The RAG pipeline automatically appends clarification notes to program verification documents, reminding users and LLMs that unverified program status denotes lack of registration in verified registries, *not* conclusive proof of malicious code.

### 4. Embedding Providers

- **Google GenAI Embeddings**:
  - Model: `gemini-embedding-001` (3,072 dimensions).
  - Uses `@google/genai` server-side SDK with batching support.
- **Local Deterministic Fallback**:
  - Model: `local-deterministic-hash-128` (128 dimensions).
  - Deterministic FNV-1a feature-hash embedding with L2 unit normalization.
  - Enables offline execution, CI builds, and unit testing without network or external API requirements.

### 5. Vector Database & Cosine Similarity

- **Storage**: Persistent JSON vector store (`data/rag_vector_store.json`), configurable via `RAG_VECTOR_STORE_PATH`.
- **Search**: Exact cosine similarity with metadata filtering (`category`, `trustLevel`).
- **Deduplication**: Content hashing (SHA-256) ensures identical chunks are never re-embedded or stored redundantly.
- **Empty Handling**: Returns empty sets gracefully with clear initialization status.

### 6. Query Construction & Evidence-to-Finding Mapping

Queries are constructed directly from deterministic STRS findings:
- **`VS-05-APPROVE`**: Queries SPL Token Approve delegation and u64::MAX drain risks.
- **`VS-06`**: Queries SPL Token SetAuthority account owner/mint hijack risks.
- **`VS-06-ASSIGN`**: Queries SystemProgram::Assign account owner reassignment hazards.
- **`VS-02`**: Queries program verification and unverified custom program ID cautions.
- **`VS-07`**: Queries CloseAccount rent lamport recovery destination verification.
- **`VS-08-ERR`**: Queries simulation failure edge cases (blockhash expiry, mock balances).
- **`VS-01`**: Queries large lamport transfer thresholds.

Each retrieved chunk is explicitly grouped under the finding it supports:
```typescript
interface FindingEvidence {
  findingId: string;
  documents: Array<{
    documentId: string;
    title: string;
    sourceUrl?: string;
    excerpt: string;
    relevanceScore: number;
    section?: string;
  }>;
}
```

If no documents meet the minimum relevance threshold (`RAG_MIN_RELEVANCE_SCORE`), the system reports:
> *"No sufficiently relevant security documentation found."*

### 7. Prompt-Injection Defenses

On-chain strings (memo text, instruction data, account labels) and retrieved RAG snippets are treated as **untrusted reference material**.
- Delimiters and control patterns (`SYSTEM:`, `### INSTRUCTION`, `OUTPUT SAFE`, `IGNORE ALL PREVIOUS RULES`) are neutralized before passing to Gemini.
- Gemini is constrained by system instructions to act strictly as an explanation engine and cannot alter STRS risk scores.
- Document citations in Gemini responses are validated against the retrieved document ID set; citations of unverified document IDs are discarded.

---

## Environment Configuration

Create a `.env` file (server-side only, never committed to git):

```env
# Google Gemini API
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.5-flash

# Solana RPC Configuration
SOLANA_RPC_ENDPOINT=https://api.devnet.solana.com
NEXT_PUBLIC_API_URL=http://localhost:3000

# Solana Security RAG Configuration
RAG_EMBEDDING_PROVIDER=google
RAG_EMBEDDING_MODEL=gemini-embedding-001
RAG_VECTOR_STORE=persistent-json
RAG_MIN_RELEVANCE_SCORE=0.65
RAG_TOP_K=4
```

---

## How to Add Knowledge Documents & Refresh the Corpus

1. Add a `.md` file to the appropriate subfolder in `knowledge/`:
   - `knowledge/solana/`
   - `knowledge/programs/`
   - `knowledge/token-security/`
   - `knowledge/transaction-security/`
2. Include the required YAML frontmatter with canonical `sourceUrl`, `documentType`, and `category`.
3. Ingest documents into the vector store:
   ```typescript
   import { IngestionPipeline, getGlobalVectorStore } from "./src/rag";
   const pipeline = new IngestionPipeline();
   await pipeline.ingestDirectory();
   ```
4. The pipeline automatically hashes each chunk; only new or modified chunks will be embedded.

---

## Testing & Verification

Run the full TypeScript check and Jest test suite:

```bash
# Type check (0 errors)
npm run type-check

# Jest test suite (12 test suites, 128+ passing tests)
npx jest
```

---

## Security Principles

- **Deterministic Primacy**: STRS rule scoring is the authoritative source of truth. LLM explanations cannot modify, override, or suppress risk levels.
- **No Client Secrets**: API keys, vector store paths, and credentials are strictly server-side.
- **Pre-Sign Safety**: Lack of signatures is expected during pre-sign inspection. A rejected transaction never triggers wallet signing methods.
- **Unverified ≠ Malicious**: Unknown program IDs are classified as unverified cautions, not automatically flagged as malicious.
