// Predictive prefetch. Given a /decide response, fetch and buffer the manifests for the candidate
// next cuts AHEAD of the branch point so the chosen one is ready with no stall. We always buffer the
// chosen next_variant_id first (it is the most likely play), then the top-k prefetch hints, capped to
// bound egress (the brief: keep top-k small, 2 to 3). A variant that 404s is dropped, not fatal.
//
// SCOPE: this proves the BUFFERING decision and bookkeeping in the test environment. It does not own
// the decoder. In the real runtime each buffered entry fronts a decoder that has parsed the playlist
// and pre-loaded the opening segments; here the playlist text stands in for "ready to switch to".
// Device-level pre-buffer timing is W5's on-hardware phase and is flagged, not faked. No em dashes.

import type { Transport } from "./transport.js";
import { VariantNotFoundError } from "./transport.js";
import type { BufferedVariant, DecideResponse, VariantId } from "./types.js";

export interface PrefetchOptions {
  // Max prefetch hints to buffer beyond the chosen cut. Bounds egress. Default 3 (brief: 2 to 3).
  topK?: number;
  // Monotonic clock, injectable for deterministic tests. Default Date.now.
  now?: () => number;
}

export interface PrefetchResult {
  // Every candidate that became ready (chosen first, then hints in priority order).
  readonly buffered: readonly BufferedVariant[];
  // Candidate ids that were requested but failed (e.g. 404). Surfaced for diagnostics, not fatal.
  readonly missed: readonly VariantId[];
}

const DEFAULT_TOP_K = 3;

// The set of variant ids to buffer for one decision, in priority order: the chosen cut first, then
// the prefetch hints, de-duplicated, capped at topK hints. Exported so the switch logic and tests can
// reason about exactly what the player intends to buffer without performing IO.
export function prefetchPlan(decision: DecideResponse, topK = DEFAULT_TOP_K): VariantId[] {
  const ordered: VariantId[] = [decision.next_variant_id];
  const hints = decision.prefetch_variant_ids ?? [];
  for (const id of hints.slice(0, Math.max(0, topK))) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  return ordered;
}

// A small buffer that holds ready candidate cuts for the upcoming branch point. It is keyed by
// variant id, so re-deciding (which often re-lists the same hints) reuses what is already buffered
// instead of re-fetching. Call prefetch() at the boundary, then take()/has() at the branch point.
export class PrefetchBuffer {
  private readonly entries = new Map<VariantId, BufferedVariant>();
  private readonly topK: number;
  private readonly now: () => number;

  constructor(
    private readonly transport: Transport,
    opts: PrefetchOptions = {}
  ) {
    this.topK = opts.topK ?? DEFAULT_TOP_K;
    this.now = opts.now ?? Date.now;
  }

  has(variantId: VariantId): boolean {
    return this.entries.has(variantId);
  }

  get(variantId: VariantId): BufferedVariant | undefined {
    return this.entries.get(variantId);
  }

  get size(): number {
    return this.entries.size;
  }

  // Fetch and buffer the chosen cut plus the top-k hints for this decision, concurrently. Already
  // buffered ids are not re-fetched. Returns what is ready and what missed. Egress is bounded by topK.
  async prefetch(decision: DecideResponse): Promise<PrefetchResult> {
    const plan = prefetchPlan(decision, this.topK);
    const toFetch = plan.filter((id) => !this.entries.has(id));

    const missed: VariantId[] = [];
    await Promise.all(
      toFetch.map(async (variantId) => {
        try {
          const playlist = await this.transport.fetchManifest(variantId);
          this.entries.set(variantId, { variantId, playlist, bufferedAt: this.now() });
        } catch (err) {
          if (err instanceof VariantNotFoundError) {
            missed.push(variantId);
            return;
          }
          throw err;
        }
      })
    );

    const buffered = plan
      .map((id) => this.entries.get(id))
      .filter((e): e is BufferedVariant => e !== undefined);
    return { buffered, missed };
  }

  // Drop every buffered candidate that is not in keep. Called after a switch so the buffer for the
  // NEXT branch point starts from the cut we actually played, evicting the cuts we passed on. This is
  // the egress + memory bound between branch points.
  evictExcept(keep: readonly VariantId[]): void {
    const keepSet = new Set(keep);
    for (const id of [...this.entries.keys()]) {
      if (!keepSet.has(id)) this.entries.delete(id);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
