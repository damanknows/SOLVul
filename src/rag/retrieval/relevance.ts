// src/rag/retrieval/relevance.ts
import type { ScoredChunk, FindingEvidence, FindingEvidenceDocument } from "../types";
import { formatEvidenceClarification } from "../security/provenance";

export interface RelevanceFilterOptions {
  minScore: number;
  topK: number;
  deduplicateByDocument?: boolean;
}

/**
 * Filters and deduplicates retrieval results according to minimum score and capacity bounds.
 */
export function filterAndRankChunks(
  results: ScoredChunk[],
  options: RelevanceFilterOptions,
): ScoredChunk[] {
  const { minScore, topK, deduplicateByDocument = true } = options;

  // Filter by threshold
  const qualifying = results.filter((r) => r.relevanceScore >= minScore);

  // Sort descending
  qualifying.sort((a, b) => b.relevanceScore - a.relevanceScore);

  if (!deduplicateByDocument) {
    return qualifying.slice(0, Math.max(1, topK));
  }

  // Deduplicate by documentId
  const seenDocs = new Set<string>();
  const deduplicated: ScoredChunk[] = [];

  for (const item of qualifying) {
    if (!seenDocs.has(item.chunk.documentId)) {
      seenDocs.add(item.chunk.documentId);
      deduplicated.push(item);
    }
    if (deduplicated.length >= topK) {
      break;
    }
  }

  return deduplicated;
}

/**
 * Groups scored chunks into FindingEvidence structures mapped directly to finding IDs.
 */
export function mapChunksToFindingEvidence(
  scoredChunks: ScoredChunk[],
): FindingEvidence[] {
  const findingMap = new Map<string, FindingEvidenceDocument[]>();

  for (const item of scoredChunks) {
    const findingId = item.findingId || "GENERAL";
    if (!findingMap.has(findingId)) {
      findingMap.set(findingId, []);
    }

    const docList = findingMap.get(findingId)!;

    const clarification = formatEvidenceClarification(item.chunk);
    const excerpt = clarification
      ? `${item.chunk.content}\n\n[${clarification}]`
      : item.chunk.content;

    docList.push({
      documentId: item.chunk.id,
      title: item.chunk.title,
      sourceUrl: item.chunk.sourceUrl,
      excerpt,
      relevanceScore: item.relevanceScore,
      section: item.chunk.section,
      trustLevel: item.chunk.trustLevel,
    });
  }

  return Array.from(findingMap.entries()).map(([findingId, documents]) => ({
    findingId,
    documents,
  }));
}
