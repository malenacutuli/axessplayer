// P5-T1 two-tower retrieval. A viewer tower and an item tower each linearly project their feature vector
// to a shared embedding space; the retrieval score is the dot product, and we return the top-K items.
// Cold start uses identity towers (embedding = features), which is a sensible affinity prior (a viewer
// who completes and returns scores items that others complete and return). Training the tower weights
// from logged engagement is a clear interface here and an offline job later (flagged). No em dashes.

export type Tower = { weights: number[][] }; // embedDim x featureDim

export function identityTower(dim: number): Tower {
  return { weights: Array.from({ length: dim }, (_, i) => Array.from({ length: dim }, (_, j) => (i === j ? 1 : 0))) };
}

// Project a feature vector through a tower to its embedding.
export function embed(tower: Tower, vector: number[]): number[] {
  return tower.weights.map((row) => row.reduce((s, w, j) => s + w * (vector[j] ?? 0), 0));
}

export function dot(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export type Retrieved = { seriesId: string; score: number };

// Retrieve the top-K item embeddings by dot-product similarity to the viewer embedding. Deterministic:
// ties break by seriesId so the order is stable and testable.
export function retrieveTopK(
  viewerEmbedding: number[],
  items: { seriesId: string; embedding: number[] }[],
  k: number,
): Retrieved[] {
  const scored = items.map((it) => ({ seriesId: it.seriesId, score: dot(viewerEmbedding, it.embedding) }));
  scored.sort((a, b) => (b.score - a.score) || (a.seriesId < b.seriesId ? -1 : a.seriesId > b.seriesId ? 1 : 0));
  return scored.slice(0, Math.max(0, k));
}
