// src/rag/storage/documentStore.ts
import type { RawKnowledgeDocument } from "../types";

export class DocumentStore {
  private documents: Map<string, RawKnowledgeDocument> = new Map();

  public addDocument(doc: RawKnowledgeDocument): void {
    this.documents.set(doc.id, doc);
  }

  public getDocument(id: string): RawKnowledgeDocument | undefined {
    return this.documents.get(id);
  }

  public hasDocument(id: string): boolean {
    return this.documents.has(id);
  }

  public getAllDocuments(): RawKnowledgeDocument[] {
    return Array.from(this.documents.values());
  }

  public clear(): void {
    this.documents.clear();
  }

  public get count(): number {
    return this.documents.size;
  }
}
