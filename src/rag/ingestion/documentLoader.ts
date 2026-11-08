// src/rag/ingestion/documentLoader.ts
import fs from "fs";
import path from "path";
import type { RawKnowledgeDocument, DocumentCategory, DocumentType, TrustLevel } from "../types";
import { parseFrontmatter } from "./metadata";
import { validateDocumentProvenance } from "../security/provenance";

/**
 * Recursively scans directory for .md files and loads them into RawKnowledgeDocument structures.
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
 */
export function loadDocumentFromFile(filePath: string): RawKnowledgeDocument | null {
  const content = fs.readFileSync(filePath, "utf8");
  const fileName = path.basename(filePath, path.extname(filePath));

  if (filePath.endsWith(".json")) {
    const parsed = JSON.parse(content);
    return {
      id: parsed.id || fileName,
      title: parsed.title || fileName,
      sourceUrl: parsed.sourceUrl,
      publisher: parsed.publisher,
      documentType: (parsed.documentType as DocumentType) || "official_docs",
      category: (parsed.category as DocumentCategory) || "solana",
      trustLevel: (parsed.trustLevel as TrustLevel) || "authoritative",
      createdAt: parsed.createdAt || new Date().toISOString(),
      updatedAt: parsed.updatedAt,
      content: parsed.content || "",
    };
  }

  const { metadata, body } = parseFrontmatter(content);

  const documentType = (metadata.documentType as DocumentType) || "official_docs";
  const category = (metadata.category as DocumentCategory) || "solana";
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
