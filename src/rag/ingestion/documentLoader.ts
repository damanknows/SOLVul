// src/rag/ingestion/documentLoader.ts
import fs from "fs";
import path from "path";
import type { RawKnowledgeDocument, DocumentCategory, DocumentType, TrustLevel } from "../types";
import { parseFrontmatter } from "./metadata";
import { validateDocumentProvenance } from "../security/provenance";

/**
 * Validates document metadata structure and URLs.
 */
export function validateDocumentMetadata(meta: {
  id?: string;
  title?: string;
  sourceUrl?: string;
  content?: string;
}): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!meta.title || !meta.title.trim()) {
    errors.push("Document title is missing or empty");
  }
  if (meta.sourceUrl) {
    try {
      const u = new URL(meta.sourceUrl);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        errors.push("Invalid sourceUrl format (must be HTTP or HTTPS URL)");
      } else if (!u.hostname) {
        errors.push("Invalid sourceUrl format (missing hostname)");
      }
    } catch {
      errors.push("Invalid sourceUrl format");
    }
  }
  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Recursively scans directory for .md and .json files and loads them into RawKnowledgeDocument structures.
 */
export function loadDocumentsFromDirectory(dirPath: string): RawKnowledgeDocument[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const documents: RawKnowledgeDocument[] = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      documents.push(...loadDocumentsFromDirectory(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".json"))) {
      try {
        const doc = loadDocumentFromFile(fullPath);
        if (doc) {
          documents.push(doc);
        }
      } catch {
        // Skip unparseable files without crashing the loader
      }
    }
  }

  return documents;
}

/**
 * Loads a single knowledge document from a markdown or JSON file.
 *
 * Hardening:
 * A document (JSON or Markdown) must NEVER be able to declare its own trust level.
 * Trust levels are strictly assigned by validateDocumentProvenance based on verified domains.
 */
export function loadDocumentFromFile(filePath: string): RawKnowledgeDocument | null {
  const content = fs.readFileSync(filePath, "utf8");
  const fileName = path.basename(filePath, path.extname(filePath));

  if (filePath.endsWith(".json")) {
    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      return null;
    }

    const documentType = (parsed.documentType as DocumentType) || "official_docs";
    const category = (parsed.category as DocumentCategory) || "solana";
    
    // Crucial: Self-asserted trustLevel is discarded; trust is assigned strictly via provenance
    const trustLevel = validateDocumentProvenance({
      title: parsed.title || fileName,
      sourceUrl: parsed.sourceUrl,
      publisher: parsed.publisher,
      documentType,
    });

    return {
      id: parsed.id || fileName,
      title: parsed.title || fileName,
      sourceUrl: parsed.sourceUrl,
      publisher: parsed.publisher,
      documentType,
      category,
      trustLevel,
      createdAt: parsed.createdAt || new Date().toISOString(),
      updatedAt: parsed.updatedAt,
      content: parsed.content || "",
    };
  }

  const { metadata, body } = parseFrontmatter(content);

  const documentType = (metadata.documentType as DocumentType) || "official_docs";
  const category = (metadata.category as DocumentCategory) || "solana";
  
  // Crucial: Self-asserted trustLevel in frontmatter is discarded; trust is assigned strictly via provenance
  const trustLevel = validateDocumentProvenance({
    title: metadata.title || fileName,
    sourceUrl: metadata.sourceUrl,
    publisher: metadata.publisher,
    documentType,
  });

  return {
    id: metadata.id || fileName,
    title: metadata.title || fileName,
    sourceUrl: metadata.sourceUrl,
    publisher: metadata.publisher,
    documentType,
    category,
    trustLevel,
    createdAt: metadata.createdAt || new Date().toISOString(),
    updatedAt: metadata.updatedAt,
    content: body.trim(),
  };
}
