// The headline correctness test: flattenGraph must lift variants out of the nested graph and RE-STAMP
// beat_id onto each one (the live service omits it). This is the consumer-app bug, guarded here. No em
// dashes.
import { describe, it, expect } from "vitest";
import { flattenGraph } from "../src/api/flattenGraph.js";
import type { SeriesGraph } from "../src/api/contractGap.js";

const NESTED: SeriesGraph = {
  series: {
    id: "11111111-1111-1111-1111-111111111111",
    title: "The Last Signal",
    genre: "thriller",
    base_language: "en",
    available_languages: ["en"],
    cover_url: null,
  },
  episodes: [
    {
      id: "22222222-2222-2222-2222-222222222222",
      episode_number: 1,
      title: "Pilot",
      is_free: true,
      coin_cost: 0,
      beats: [
        {
          id: "bbbbbbbb-0000-0000-0000-000000000001",
          episode_id: "22222222-2222-2222-2222-222222222222",
          beat_index: 0,
          role: "cold_open",
          is_branch_point: false,
          canon_facts: {},
          // NOTE: no beat_id on the variant, exactly as the live service returns it.
          variants: [
            {
              id: "cccccccc-0000-0000-0000-000000000001",
              language: "en",
              accessibility: { captions: true },
              intensity: 3,
              pov: null,
              tier: "A_filmed",
              is_premium: false,
              coin_cost: 0,
              playback_url: "https://cdn/cold.m3u8",
              duration_ms: 8000,
              qa_status: "passed",
            },
          ],
        },
        {
          id: "bbbbbbbb-0000-0000-0000-000000000004",
          episode_id: "22222222-2222-2222-2222-222222222222",
          beat_index: 3,
          role: "ending",
          is_branch_point: false,
          canon_facts: {},
          variants: [
            {
              id: "cccccccc-0000-0000-0000-000000000005",
              language: "en",
              accessibility: {},
              intensity: 4,
              pov: null,
              tier: "A_filmed",
              is_premium: true,
              coin_cost: 5,
              playback_url: "https://cdn/premium.m3u8",
              duration_ms: 9000,
              qa_status: "passed",
            },
          ],
        },
      ],
    },
  ],
  edges: [
    {
      from_beat_id: "bbbbbbbb-0000-0000-0000-000000000001",
      to_beat_id: "bbbbbbbb-0000-0000-0000-000000000004",
      condition: {},
    },
  ],
};

describe("flattenGraph", () => {
  it("re-stamps beat_id onto every variant (the nested-graph fix)", () => {
    const flat = flattenGraph(NESTED);
    expect(flat.variants).toHaveLength(2);
    for (const v of flat.variants) {
      expect(typeof v.beat_id).toBe("string");
      expect(v.beat_id.length).toBeGreaterThan(0);
    }
    const cold = flat.variants.find((v) => v.id === "cccccccc-0000-0000-0000-000000000001");
    const prem = flat.variants.find((v) => v.id === "cccccccc-0000-0000-0000-000000000005");
    expect(cold?.beat_id).toBe("bbbbbbbb-0000-0000-0000-000000000001");
    expect(prem?.beat_id).toBe("bbbbbbbb-0000-0000-0000-000000000004");
  });

  it("lifts beats with their episode context and exposes a beatById lookup", () => {
    const flat = flattenGraph(NESTED);
    expect(flat.beats).toHaveLength(2);
    expect(flat.beats[0]?.episode_number).toBe(1);
    expect(flat.beatById.get("bbbbbbbb-0000-0000-0000-000000000004")?.role).toBe("ending");
    expect(flat.seriesTitle).toBe("The Last Signal");
    expect(flat.edges).toHaveLength(1);
  });

  it("carries premium and coin_cost through to the flat variant for pricing", () => {
    const flat = flattenGraph(NESTED);
    const prem = flat.variants.find((v) => v.is_premium);
    expect(prem?.coin_cost).toBe(5);
  });
});
