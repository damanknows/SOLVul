// src/rag/__tests__/embeddings.test.ts
import {
  LocalDeterministicEmbeddingService,
  GoogleEmbeddingService,
  getEmbeddingService,
} from "../embeddings/embeddingService";

describe("Phase 8 - Embedding Services", () => {
  test("1. LocalDeterministicEmbeddingService generates unit vectors with consistent dimension", async () => {
    const service = new LocalDeterministicEmbeddingService();
    expect(service.dimension).toBe(128);

    const vec = await service.generateEmbedding("Solana SPL Token Approve delegation");
    expect(vec.length).toBe(128);

    // Verify L2 norm is ~1.0
    let norm = 0;
    for (const val of vec) {
      norm += val * val;
    }
    expect(Math.sqrt(norm)).toBeCloseTo(1.0, 3);
  });

  test("2. LocalDeterministicEmbeddingService generates higher similarity for related semantic texts", async () => {
    const service = new LocalDeterministicEmbeddingService();

    const vApprove1 = await service.generateEmbedding("SPL Token Approve delegate authority transfer");
    const vApprove2 = await service.generateEmbedding("Token Approve instruction delegation drainage");
    const vUnrelated = await service.generateEmbedding("Cooking Italian pasta recipe with tomatoes");

    let simRelated = 0;
    let simUnrelated = 0;

    for (let i = 0; i < 128; i++) {
      simRelated += vApprove1[i] * vApprove2[i];
      simUnrelated += vApprove1[i] * vUnrelated[i];
    }

    expect(simRelated).toBeGreaterThan(simUnrelated);
  });

  test("3. Generates batch embeddings correctly", async () => {
    const service = new LocalDeterministicEmbeddingService();
    const texts = ["First sentence", "Second sentence", "Third sentence"];
    const vectors = await service.generateEmbeddings(texts);

    expect(vectors.length).toBe(3);
    expect(vectors[0].length).toBe(128);
    expect(vectors[1].length).toBe(128);
    expect(vectors[2].length).toBe(128);
  });

  test("4. GoogleEmbeddingService throws descriptive error on API failure", async () => {
    const mockClient: any = {
      models: {
        embedContent: jest.fn().mockRejectedValue(new Error("API rate limit exceeded (429)")),
      },
    };

    const service = new GoogleEmbeddingService("gemini-embedding-001", mockClient);

    await expect(service.generateEmbedding("test query")).rejects.toThrow(
      /GoogleEmbeddingService failure.*API rate limit exceeded/,
    );
  });
});
