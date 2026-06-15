// The content-graph interchange must be stable (diffable) and surface broken edges. No em dashes.
import { describe, it, expect } from "vitest";
import { toInterchange, serializeInterchange, brokenEdges } from "../src/api/graphInterchange.js";
import type { FlatGraph } from "../src/api/flattenGraph.js";

function graph(): FlatGraph {
  const beats = [
    // Intentionally out of order to prove the export sorts by (episode, beat_index).
    { id: "b2", episode_id: "e1", episode_number: 1, episode_title: null, beat_index: 1, role: "spine", is_branch_point: true, canon_facts: {}, variant_ids: ["v2"] },
    { id: "b1", episode_id: "e1", episode_number: 1, episode_title: null, beat_index: 0, role: "cold_open", is_branch_point: false, canon_facts: {}, variant_ids: ["v1"] },
  ];
  const variants = [
    { id: "v1", beat_id: "b1", beat_index: 0, beat_role: "cold_open", episode_id: "e1", episode_number: 1, language: "en", accessibility: {}, intensity: 3, pov: null, tier: "A_filmed", is_premium: false, coin_cost: 0, playback_url: "u1", duration_ms: null, qa_status: "pending" },
    { id: "v2", beat_id: "b2", beat_index: 1, beat_role: "spine", episode_id: "e1", episode_number: 1, language: "en", accessibility: {}, intensity: 5, pov: null, tier: "A_filmed", is_premium: false, coin_cost: 0, playback_url: "u2", duration_ms: null, qa_status: "pending" },
  ];
  const edges = [{ from_beat_id: "b1", to_beat_id: "b2", condition: {} }];
  return {
    seriesId: "s1",
    seriesTitle: "My Story",
    baseLanguage: "en",
    episodeCount: 1,
    beats,
    variants,
    edges,
    beatById: new Map(beats.map((b) => [b.id, b])),
  } as unknown as FlatGraph;
}

describe("graphInterchange", () => {
  it("emits beats in stable (episode, beat_index) order with variants nested", () => {
    const ic = toInterchange(graph());
    expect(ic.kind).toBe("axessplayer.story-graph");
    expect(ic.series).toMatchObject({ id: "s1", title: "My Story", base_language: "en" });
    expect(ic.beats.map((b) => b.id)).toEqual(["b1", "b2"]); // sorted, not input order
    expect(ic.beats[0].variants.map((v) => v.id)).toEqual(["v1"]);
    expect(ic.edges).toEqual([{ from: "b1", to: "b2", condition: {} }]);
  });

  it("is deterministic: the same graph serializes identically", () => {
    expect(serializeInterchange(graph())).toBe(serializeInterchange(graph()));
  });

  it("flags broken edges that point at a missing beat", () => {
    const g = graph();
    g.edges.push({ from_beat_id: "b2", to_beat_id: "ghost", condition: {} });
    expect(brokenEdges(g)).toEqual([{ from: "b2", to: "ghost" }]);
  });
});
