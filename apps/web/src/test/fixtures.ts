// Test fixtures mirroring the walking-skeleton seed (supabase/seed.sql). One series, one episode, a
// cold open, a branch at beat 2 (calm vs tense), a shared ending, and a premium alternate ending.
// These ids match the seed so the web flows are tested against the same graph the services serve.
// No em dashes.

import type { SeriesGraph } from "../api/content.js";

export const SERIES_ID = "11111111-1111-1111-1111-111111111111";

export const BEAT_COLD_OPEN = "bbbbbbbb-0000-0000-0000-000000000001";
export const BEAT_BRANCH = "bbbbbbbb-0000-0000-0000-000000000002";
export const BEAT_CALM = "bbbbbbbb-0000-0000-0000-00000000000a";
export const BEAT_TENSE = "bbbbbbbb-0000-0000-0000-00000000000b";
export const BEAT_ENDING = "bbbbbbbb-0000-0000-0000-000000000004";

export const VAR_COLD_OPEN = "cccccccc-0000-0000-0000-000000000001";
export const VAR_BRANCHPOINT = "cccccccc-0000-0000-0000-000000000002";
export const VAR_CALM = "cccccccc-0000-0000-0000-00000000000a";
export const VAR_TENSE = "cccccccc-0000-0000-0000-00000000000b";
export const VAR_ENDING = "cccccccc-0000-0000-0000-000000000004";
export const VAR_ENDING_PREMIUM = "cccccccc-0000-0000-0000-000000000005";

export function seedGraph(): SeriesGraph {
  return {
    series: {
      id: SERIES_ID,
      title: "The Last Signal",
      genre: "thriller",
      base_language: "en",
    },
    episodes: [
      {
        id: "22222222-2222-2222-2222-222222222222",
        series_id: SERIES_ID,
        episode_number: 1,
        title: "Pilot",
        is_free: true,
        coin_cost: 0,
      },
    ],
    beats: [
      { id: BEAT_COLD_OPEN, episode_id: "22222222-2222-2222-2222-222222222222", beat_index: 0, role: "cold_open", is_branch_point: false },
      { id: BEAT_BRANCH, episode_id: "22222222-2222-2222-2222-222222222222", beat_index: 1, role: "spine", is_branch_point: true },
      { id: BEAT_CALM, episode_id: "22222222-2222-2222-2222-222222222222", beat_index: 2, role: "variant", is_branch_point: false },
      { id: BEAT_TENSE, episode_id: "22222222-2222-2222-2222-222222222222", beat_index: 2, role: "variant", is_branch_point: false },
      { id: BEAT_ENDING, episode_id: "22222222-2222-2222-2222-222222222222", beat_index: 3, role: "ending", is_branch_point: false },
    ],
    // The fixture represents UPLOADED, ENCODED content: real /media URLs and qa_status passed, so the player's
    // real-media guard accepts them (a seed cdn.example placeholder would be excluded, as in production).
    variants: [
      { id: VAR_COLD_OPEN, beat_id: BEAT_COLD_OPEN, language: "en", intensity: 3, tier: "A_filmed", is_premium: false, coin_cost: 0, qa_status: "passed", playback_url: "http://media.test/media/coldopen/master.m3u8", caption_doc_url: "http://media.test/media/coldopen/captions.json", sign_video_url: "http://media.test/media/coldopen/asl_sign.webm", accessibility: { captions: true, audio_description: true, sign: true, languages: ["en", "es"] } },
      { id: VAR_BRANCHPOINT, beat_id: BEAT_BRANCH, language: "en", intensity: 3, tier: "A_filmed", is_premium: false, coin_cost: 0, qa_status: "passed", playback_url: "http://media.test/media/branchpoint/master.m3u8", accessibility: { captions: true, audio_description: false, sign: false, languages: ["en"] } },
      { id: VAR_CALM, beat_id: BEAT_CALM, language: "en", intensity: 2, tier: "A_filmed", is_premium: false, coin_cost: 0, qa_status: "passed", playback_url: "http://media.test/media/calm/master.m3u8", accessibility: { captions: true, audio_description: true, sign: true, languages: ["en"] } },
      { id: VAR_TENSE, beat_id: BEAT_TENSE, language: "en", intensity: 5, tier: "A_filmed", is_premium: false, coin_cost: 0, qa_status: "passed", playback_url: "http://media.test/media/tense/master.m3u8", accessibility: { captions: true, audio_description: true, sign: false, languages: ["en"] } },
      { id: VAR_ENDING, beat_id: BEAT_ENDING, language: "en", intensity: 3, tier: "A_filmed", is_premium: false, coin_cost: 0, qa_status: "passed", playback_url: "http://media.test/media/ending/master.m3u8", accessibility: { captions: true, audio_description: true, sign: true, languages: ["en"] } },
      { id: VAR_ENDING_PREMIUM, beat_id: BEAT_ENDING, language: "en", intensity: 4, tier: "A_filmed", is_premium: true, coin_cost: 5, qa_status: "passed", playback_url: "http://media.test/media/ending_premium/master.m3u8", accessibility: { captions: true, audio_description: true, sign: true, languages: ["en"] } },
    ],
    edges: [
      { from_beat_id: BEAT_COLD_OPEN, to_beat_id: BEAT_BRANCH, condition: {} },
      { from_beat_id: BEAT_BRANCH, to_beat_id: BEAT_CALM, condition: { branch: "calm" } },
      { from_beat_id: BEAT_BRANCH, to_beat_id: BEAT_TENSE, condition: { branch: "tense" } },
      { from_beat_id: BEAT_CALM, to_beat_id: BEAT_ENDING, condition: {} },
      { from_beat_id: BEAT_TENSE, to_beat_id: BEAT_ENDING, condition: {} },
    ],
  };
}

// The NESTED graph shape the real content service returns (episodes[].beats[].variants[] plus
// top-level edges). The content client flattens this at its boundary. The mock server serves this so
// the flatten the app relies on is exercised, exactly as it is against the live service. Derived from
// the flat seedGraph so the two never drift. No em dashes.
export function nestedSeedGraph(): unknown {
  const g = seedGraph();
  return {
    series: g.series,
    episodes: g.episodes.map((ep) => ({
      id: ep.id,
      episode_number: ep.episode_number,
      title: ep.title,
      is_free: ep.is_free,
      coin_cost: ep.coin_cost,
      beats: g.beats
        .filter((b) => b.episode_id === ep.id)
        .map((b) => ({
          id: b.id,
          episode_id: b.episode_id,
          beat_index: b.beat_index,
          role: b.role,
          is_branch_point: b.is_branch_point,
          variants: g.variants
            .filter((v) => v.beat_id === b.id)
            .map(({ beat_id: _beat_id, ...rest }) => rest),
        })),
    })),
    edges: g.edges,
  };
}
