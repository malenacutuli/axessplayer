// Unit tests for the hash chain primitive itself, independent of the database. Proves the chain links
// rows, that recomputation is order-stable, and that tampering or reordering is detected. No em dashes.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRowHash,
  verifyChain,
  GENESIS_PREV_HASH,
  type ConsentContent,
  type ChainRow,
} from "../src/hashChain.js";

function content(i: number): ConsentContent {
  return {
    likeness_subject: `actor-${i}`,
    beat_variant_id: "cccccccc-0000-0000-0000-000000000001",
    consent_ref: `consent-${i}`,
    royalty_terms: { pct: i },
    created_at: `2026-06-15T10:00:0${i}.000Z`,
  };
}

function buildChain(n: number): ChainRow[] {
  const rows: ChainRow[] = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i++) {
    const c = content(i);
    const h = computeRowHash(prev, c);
    rows.push({ prev_hash: prev, row_hash: h, content: c });
    prev = h;
  }
  return rows;
}

test("an intact chain of several rows verifies", () => {
  const chain = buildChain(5);
  const r = verifyChain(chain);
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.brokenAt, -1);
});

test("the genesis row carries a null prev_hash and folds in the GENESIS sentinel", () => {
  const c = content(0);
  const direct = computeRowHash(null, c);
  // Recomputing with the explicit sentinel string must match the null case.
  const viaSentinel = computeRowHash(GENESIS_PREV_HASH, c);
  assert.equal(direct, viaSentinel, "null prev_hash hashes as the GENESIS sentinel");
});

test("hashing is order-independent over object keys (canonical)", () => {
  const a: ConsentContent = {
    likeness_subject: "x",
    beat_variant_id: "v",
    consent_ref: "r",
    royalty_terms: { b: 1, a: 2 },
    created_at: "t",
  };
  const b: ConsentContent = {
    created_at: "t",
    royalty_terms: { a: 2, b: 1 },
    consent_ref: "r",
    beat_variant_id: "v",
    likeness_subject: "x",
  };
  assert.equal(computeRowHash(null, a), computeRowHash(null, b));
});

test("mutating a row's content is detected (row_hash no longer matches)", () => {
  const chain = buildChain(4);
  // Tamper with the content of row 1 without recomputing its row_hash.
  chain[1].content.consent_ref = "FORGED";
  const r = verifyChain(chain);
  assert.equal(r.ok, false);
  assert.equal(r.brokenAt, 1);
});

test("recomputing the tampered row's hash still breaks the chain at the next link", () => {
  const chain = buildChain(4);
  // A sophisticated attacker who also recomputes the row_hash of the row they edited still cannot
  // patch the chain: row 2's prev_hash no longer matches row 1's new row_hash.
  chain[1].content.consent_ref = "FORGED";
  chain[1].row_hash = computeRowHash(chain[1].prev_hash, chain[1].content);
  const r = verifyChain(chain);
  assert.equal(r.ok, false);
  assert.equal(r.brokenAt, 2, "the break surfaces at the next row's prev_hash link");
});

test("reordering rows is detected", () => {
  const chain = buildChain(4);
  [chain[1], chain[2]] = [chain[2], chain[1]];
  const r = verifyChain(chain);
  assert.equal(r.ok, false);
});

test("an empty chain is trivially intact", () => {
  assert.equal(verifyChain([]).ok, true);
});
