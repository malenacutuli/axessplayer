// Tamper-evident hash chain for the consent ledger. This is a signed append-only log, NOT a smart
// contract. Each row commits to its own content and to the previous row's hash, so any mutation of a
// past row breaks every hash after it and verification fails. No em dashes.

import { createHash } from "node:crypto";
import { canonicalize } from "./canonical.js";

// Sentinel prev_hash for the very first row in a chain (genesis). Stored as NULL in the column but
// folded into the hash as this fixed string so the genesis row still has a well-defined row_hash.
export const GENESIS_PREV_HASH = "GENESIS";

// The content of a consent row that is committed to by row_hash. Order independent: canonicalize sorts.
export interface ConsentContent {
  likeness_subject: string;
  beat_variant_id: string;
  consent_ref: string;
  royalty_terms: unknown; // JSONB; may be null
  created_at: string; // ISO timestamp, part of the committed content
}

// row_hash = sha256( prevHash || canonical(content) ). prevHash is the previous row's row_hash, or the
// GENESIS sentinel for the first row. Binding prevHash in makes the chain order-dependent and tamper
// evident: change any earlier row and every later row_hash no longer matches.
export function computeRowHash(prevHash: string | null, content: ConsentContent): string {
  const prev = prevHash ?? GENESIS_PREV_HASH;
  return createHash("sha256").update(prev).update("\n").update(canonicalize(content)).digest("hex");
}

export interface ChainRow {
  prev_hash: string | null;
  row_hash: string;
  content: ConsentContent;
}

export interface ChainCheck {
  ok: boolean;
  // index of the first row that fails, or -1 when the chain is intact.
  brokenAt: number;
  reason?: string;
}

// Verify a chain in append order. The first row must declare a null prev_hash (genesis). Every row's
// stored row_hash must equal the recomputed hash, and every row's prev_hash must equal the prior row's
// row_hash. Any deviation is a tamper or a reordering and fails closed.
export function verifyChain(rows: ChainRow[]): ChainCheck {
  if (rows.length === 0) return { ok: true, brokenAt: -1 };
  let expectedPrev: string | null = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.prev_hash !== expectedPrev) {
      return { ok: false, brokenAt: i, reason: "prev_hash does not link to the previous row" };
    }
    const recomputed = computeRowHash(row.prev_hash, row.content);
    if (recomputed !== row.row_hash) {
      return { ok: false, brokenAt: i, reason: "row_hash does not match row content (tampered)" };
    }
    expectedPrev = row.row_hash;
  }
  return { ok: true, brokenAt: -1 };
}
