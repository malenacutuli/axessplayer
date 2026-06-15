// Deterministic canonical JSON serialization. Both the consent hash chain and the test signer need
// a stable byte representation of an object so the same logical value always hashes the same way,
// regardless of key insertion order. JSON.stringify is not order-stable across objects, so we sort
// keys recursively. No em dashes.

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortDeep(value as Json));
}

function sortDeep(value: Json): Json {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortDeep);
  const out: { [k: string]: Json } = {};
  for (const key of Object.keys(value).sort()) {
    out[key] = sortDeep(value[key]);
  }
  return out;
}
