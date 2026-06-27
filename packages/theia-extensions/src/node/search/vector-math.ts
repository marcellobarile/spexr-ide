/** Cosine similarity of two equal-length vectors; 0 if either is zero-length. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Indices of the highest `scores`, descending, keeping only those `>= minScore`
 * and at most `k` of them.
 */
export function topKIndices(scores: number[], k: number, minScore: number): number[] {
  return scores
    .map((score, index) => ({ score, index }))
    .filter((s) => s.score >= minScore)
    .sort((x, y) => y.score - x.score)
    .slice(0, k)
    .map((s) => s.index);
}
