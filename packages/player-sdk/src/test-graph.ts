// A fake Transport backed by an in-memory seed graph, for the unit tests and the demo harness. It
// models the two contract calls deterministically:
//   - decide(beatId): returns the next cut + prefetch hints for that beat, or rejects
//     NoSuccessorsError when the beat is an ending (contract 422).
//   - fetchManifest(variantId): returns a tiny HLS playlist for a known variant, or rejects
//     VariantNotFoundError (contract 404) for an unknown one.
// It also counts calls so tests can assert egress (how many manifests were fetched). No em dashes.

import {
  NoSuccessorsError,
  VariantNotFoundError,
  type Transport,
} from "./transport.js";
import type { DecideRequest, DecideResponse, VariantId } from "./types.js";

// One beat node in the seed graph: the cut the engine chooses next, the prefetch hints it returns,
// and whether the viewer is on the control arm at this beat.
export interface GraphNode {
  nextVariantId: VariantId;
  prefetchVariantIds: VariantId[];
  isControl?: boolean;
}

export interface FakeTransportOptions {
  // beatId -> node. A beat absent from the map is an ending (decide rejects 422).
  graph: Record<string, GraphNode>;
  // variant ids that have a manifest. Any other requested id 404s. Defaults to every id named in the
  // graph (next + prefetch), so the happy path "just works" unless a test plants a missing variant.
  knownVariants?: Set<VariantId>;
  policyVersion?: string;
}

export interface CallCounts {
  decide: number;
  manifest: number;
  manifestByVariant: Map<VariantId, number>;
}

export class FakeTransport implements Transport {
  readonly calls: CallCounts = { decide: 0, manifest: 0, manifestByVariant: new Map() };
  private readonly graph: Record<string, GraphNode>;
  private readonly known: Set<VariantId>;
  private readonly policyVersion: string;
  private decideSeq = 0;

  constructor(opts: FakeTransportOptions) {
    this.graph = opts.graph;
    this.policyVersion = opts.policyVersion ?? "fake-v0";
    this.known =
      opts.knownVariants ??
      new Set(
        Object.values(opts.graph).flatMap((n) => [n.nextVariantId, ...n.prefetchVariantIds])
      );
  }

  async decide(req: DecideRequest): Promise<DecideResponse> {
    this.calls.decide++;
    const node = this.graph[req.current_beat_id];
    if (!node) throw new NoSuccessorsError();
    return {
      decision_id: `dec-${this.decideSeq++}`,
      next_variant_id: node.nextVariantId,
      prefetch_variant_ids: node.prefetchVariantIds,
      is_control: node.isControl ?? false,
      policy_version: this.policyVersion,
    };
  }

  async fetchManifest(variantId: VariantId): Promise<string> {
    this.calls.manifest++;
    this.calls.manifestByVariant.set(
      variantId,
      (this.calls.manifestByVariant.get(variantId) ?? 0) + 1
    );
    if (!this.known.has(variantId)) throw new VariantNotFoundError(variantId);
    // A minimal valid-looking HLS playlist body. The runtime parses this; here it is opaque text
    // standing in for "buffered and ready". One variant id per playlist so tests can identify it.
    return [
      "#EXTM3U",
      "#EXT-X-VERSION:7",
      "#EXT-X-TARGETDURATION:4",
      `#EXT-X-MEDIA-SEQUENCE:0`,
      "#EXTINF:4.0,",
      `${variantId}/seg0.m4s`,
      "#EXT-X-ENDLIST",
    ].join("\n");
  }
}
