// The QA gate. Every variant the pipeline produces lands qa_status = pending. A variant only becomes
// servable after it passes this gate, which promotes pending -> passed. A failed check promotes
// pending -> rejected, and a rejected variant NEVER serves. This file decides; the DB adapter persists the
// status transition. The check here asserts structural / policy properties of the produced row and
// manifest, not AI output quality (which a human or a separate model reviews when the real cost gate is
// open). No em dashes.

import type { VariantRow, QaStatus } from "./spec.js";
import { INTENSITY_MIN, INTENSITY_MAX, VARIANT_TIERS } from "./spec.js";
import type { C2paManifest } from "./c2pa.js";

export interface QaInput {
  row: VariantRow;
  manifest: C2paManifest;
}

export interface QaResult {
  status: Exclude<QaStatus, "pending">; // a gate decision is always passed or rejected
  reasons: string[]; // empty when passed; the failing checks when rejected
}

// The structural QA checks. These are the things that must hold for a variant to be safe to serve. They
// are deterministic and do not call any model. Quality review (acting, lip sync, dub naturalness) is a
// separate human / model step behind the real cost gate and is out of scope for this deterministic gate.
export function runQaCheck(input: QaInput): QaResult {
  const { row, manifest } = input;
  const reasons: string[] = [];

  // 1. The row must carry a playable url.
  if (typeof row.playback_url !== "string" || row.playback_url.length === 0) {
    reasons.push("missing_playback_url");
  }

  // 2. coin_cost must be a non-negative integer (the schema CHECK is on the wallet, not here; the gate
  //    refuses a nonsensical price before it can ever be charged).
  if (!Number.isInteger(row.coin_cost) || row.coin_cost < 0) {
    reasons.push("invalid_coin_cost");
  }

  // 3. A premium variant must actually cost coins; a free variant must not be marked premium.
  if (row.is_premium && row.coin_cost <= 0) reasons.push("premium_without_price");
  if (!row.is_premium && row.coin_cost > 0) reasons.push("priced_without_premium");

  // 4. intensity must be in the schema range.
  if (!Number.isInteger(row.intensity) || row.intensity < INTENSITY_MIN || row.intensity > INTENSITY_MAX) {
    reasons.push("intensity_out_of_range");
  }

  // 5. tier must be a known enum.
  if (!VARIANT_TIERS.includes(row.tier)) reasons.push("invalid_tier");

  // 6. The manifest must bind to this row and carry a content hash. Provenance is mandatory: an
  //    unattested variant never serves.
  if (manifest.beat_variant_id !== row.id) reasons.push("manifest_row_mismatch");
  if (manifest.tier !== row.tier) reasons.push("manifest_tier_mismatch");
  if (typeof manifest.content_hash !== "string" || manifest.content_hash.length === 0) {
    reasons.push("missing_content_hash");
  }

  // 7. duration must be present and positive for a servable segment.
  if (row.duration_ms == null || !Number.isInteger(row.duration_ms) || row.duration_ms <= 0) {
    reasons.push("invalid_duration");
  }

  return reasons.length === 0 ? { status: "passed", reasons: [] } : { status: "rejected", reasons };
}

// A convenience predicate: only a passed variant is servable. pending and rejected are not.
export function isServable(status: QaStatus): boolean {
  return status === "passed";
}
