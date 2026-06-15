// The branching player facade. One clean object the W12 end-to-end acceptance can drive
// deterministically: at each beat boundary it asks /decide, prefetches the candidate cuts, and at the
// branch point resolves the seamless switch, looping until the graph ends (contract 422). It also
// folds the beat-level signals the viewer produced into the NEXT /decide call (brief design 5).
//
// SCOPE: this owns the decision + prefetch + switch ORCHESTRATION and proves it against a fake or
// Prism-mock transport. It does NOT own the media stack: there is no decoder, no frame timing, no
// real playback clock here. Where the runtime would hand the chosen buffered cut to a decoder and
// cut at the exact branch sample, this records the SwitchDecision. Device-level frame-accurate
// playback is W5's on-hardware phase and is flagged in the report, not faked. No em dashes.

import { PrefetchBuffer, type PrefetchOptions } from "./prefetch.js";
import { decideSwitch } from "./switch.js";
import { NoSuccessorsError, type Transport } from "./transport.js";
import type {
  BeatSignals,
  DecideResponse,
  SwitchDecision,
  VariantId,
} from "./types.js";

export interface PlayerOptions {
  transport: Transport;
  // The viewer.
  userId: string;
  // The beat the session opens on (the cold-open beat id).
  startBeatId: string;
  // Prefetch tuning (topK, clock).
  prefetch?: PrefetchOptions;
  // Bandwidth floor for the switch fallback (kbps). Default handled in switch.ts.
  bandwidthFloorKbps?: number;
  // Resolve the chosen cut's VARIANT id to the BEAT id the next /decide must be made from.
  //
  // /decide takes a beat id and returns the next cut's VARIANT id (the real decision service walks
  // beat_edges from current_beat_id and joins beat_variants on to_beat_id). To advance, the next
  // /decide must be made from the chosen variant's beat, not the variant id itself. The web host
  // builds this from the content graph (variants carry beat_id). When omitted, the resolver is the
  // identity (variantId is used as the next beat id), which preserves the historical fake-graph
  // behavior the existing SDK tests rely on (those graphs key beats by the chosen variant id). No em dashes.
  resolveBeatId?: (chosenVariantId: VariantId) => VariantId;
}

// One resolved branch point: the decision the engine returned, what we played, and the buffer state.
export interface BranchStep {
  readonly beatId: string;
  readonly decision: DecideResponse;
  readonly played: SwitchDecision;
  // Variant ids that were ready in the buffer when the branch point arrived (gap audit).
  readonly bufferedAtBranch: readonly VariantId[];
  // Variant ids requested for prefetch that missed (e.g. 404). Empty on the happy path.
  readonly missed: readonly VariantId[];
}

// The seamless branching player. Stateless across sessions; create one per viewing session.
export class BranchingPlayer {
  private readonly transport: Transport;
  private readonly userId: string;
  private readonly buffer: PrefetchBuffer;
  private readonly bandwidthFloorKbps?: number;
  private readonly resolveBeatId: (chosenVariantId: VariantId) => VariantId;

  // The beat the next /decide will be made from. Advances to the played cut after each branch point.
  private currentBeatId: string;
  // Signals measured on the current beat, fed into the next /decide. Reset after each boundary.
  private pendingSignals: BeatSignals = {};
  // Latest bandwidth estimate (kbps), updated by the host as playback proceeds.
  private estimatedKbps: number | undefined;

  constructor(opts: PlayerOptions) {
    this.transport = opts.transport;
    this.userId = opts.userId;
    this.currentBeatId = opts.startBeatId;
    this.buffer = new PrefetchBuffer(opts.transport, opts.prefetch);
    this.bandwidthFloorKbps = opts.bandwidthFloorKbps;
    // Identity by default: backward compatible with the historical fake-graph tests where the chosen
    // variant id doubles as the next beat key. The web host overrides this with a graph-backed mapper.
    this.resolveBeatId = opts.resolveBeatId ?? ((variantId) => variantId);
  }

  // The host (web/native player shell) reports the viewer's beat-level behavior as it happens. These
  // are accumulated and sent on the next /decide, then cleared. completion/dwell are last-writer;
  // replays accumulates; skipped/choice are last-writer.
  recordSignals(partial: BeatSignals): void {
    this.pendingSignals = {
      ...this.pendingSignals,
      ...partial,
      ...(partial.replays !== undefined
        ? { replays: (this.pendingSignals.replays ?? 0) + partial.replays }
        : {}),
    };
  }

  // The host updates the measured downlink (from segment download throughput). Drives the low
  // bandwidth fallback in the switch decision.
  updateBandwidth(kbps: number): void {
    this.estimatedKbps = kbps;
  }

  // Run one beat boundary to the branch point:
  //   1. POST /decide with the accumulated signals.
  //   2. Prefetch the chosen cut + top-k hints concurrently (bounded egress).
  //   3. Resolve the seamless switch (or the named fallback) at the branch point.
  //   4. Advance the current beat to the played cut and evict the cuts we passed on.
  // Rejects NoSuccessorsError at the end of the graph (the caller treats it as "play to ending").
  async advance(): Promise<BranchStep> {
    const decision = await this.transport.decide({
      user_id: this.userId,
      current_beat_id: this.currentBeatId,
      signals: this.pendingSignals,
    });
    // Signals are now in flight; reset for the next beat.
    this.pendingSignals = {};

    const { missed } = await this.buffer.prefetch(decision);

    // The safe floor is the control / director's cut. The decision engine guarantees a canon-safe
    // next_variant_id even for control viewers, so we use it as the default fallback target. The
    // runtime additionally always keeps the control cut buffered; here next_variant_id doubles as it.
    const defaultVariantId = decision.next_variant_id;

    const played = decideSwitch({
      decision,
      buffer: this.buffer,
      defaultVariantId,
      estimatedKbps: this.estimatedKbps,
      bandwidthFloorKbps: this.bandwidthFloorKbps,
    });

    const bufferedAtBranch = bufferedIds(this.buffer, decision);

    const step: BranchStep = {
      beatId: this.currentBeatId,
      decision,
      played,
      bufferedAtBranch,
      missed,
    };

    // Advance to the BEAT the cut we played lives on (not the variant id): the next /decide is made
    // from that beat. With the default identity resolver this is the played variant id, preserving the
    // historical fake-graph behavior; the web host maps variant -> beat from the content graph.
    this.currentBeatId = this.resolveBeatId(played.variantId);
    this.buffer.evictExcept([played.variantId]);

    return step;
  }

  // Walk the graph from the cold open to the ending, collecting each branch step. Stops cleanly on
  // the contract 422 (no successors). maxSteps guards against a mis-seeded cyclic graph in tests.
  async play(maxSteps = 64): Promise<BranchStep[]> {
    const steps: BranchStep[] = [];
    for (let i = 0; i < maxSteps; i++) {
      try {
        steps.push(await this.advance());
      } catch (err) {
        if (err instanceof NoSuccessorsError) return steps;
        throw err;
      }
    }
    return steps;
  }

  // The beat the next /decide will be made from (the last cut played, or the cold open).
  get beatId(): string {
    return this.currentBeatId;
  }
}

// The buffered ids among this decision's candidates, in plan order. A gap-audit helper: at the branch
// point the chosen cut should appear here, which is what makes the switch seamless.
function bufferedIds(buffer: PrefetchBuffer, decision: DecideResponse): VariantId[] {
  const candidates = [decision.next_variant_id, ...(decision.prefetch_variant_ids ?? [])];
  const seen = new Set<VariantId>();
  const out: VariantId[] = [];
  for (const id of candidates) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (buffer.has(id)) out.push(id);
  }
  return out;
}
