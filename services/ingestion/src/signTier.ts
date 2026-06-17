// Sign quality tiers (C17). Auto text-to-sign (build-sign over the owned dictionary) is the DRAFT /
// assistive tier: useful and accessible, but NOT broadcast quality. Hero content uses human-interpreter
// clips matched to the transcript timecodes, which REPLACE the draft, and requires a Deaf review before
// publish. This module matches uploaded human clips to the transcript and computes coverage + the publish
// gate. Auto-sign must never be shipped AS IF it were human broadcast quality. No em dashes.

export type TranscriptSegment = { start: number; end: number; text: string };
export type HumanSignClip = { url: string; start: number; end: number };

export type SignTrack = {
  signLanguage: string;
  tier: "draft" | "quality";
  segments: { start: number; end: number; clipUrl?: string }[];
  coverage: number; // fraction of transcript segments covered by a human clip
  needsDeafReview: boolean;
};

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

// Match human-interpreter clips to the transcript segments by timecode overlap. Produces the QUALITY-tier
// track that replaces the auto draft for this language; coverage tells the review queue how complete it is.
export function matchHumanClips(signLanguage: string, transcript: TranscriptSegment[], clips: HumanSignClip[]): SignTrack {
  const segments = transcript.map((seg) => {
    const clip = clips.find((c) => overlaps(c, seg));
    return { start: seg.start, end: seg.end, clipUrl: clip?.url };
  });
  const covered = segments.filter((s) => s.clipUrl !== undefined).length;
  const coverage = transcript.length ? covered / transcript.length : 0;
  return { signLanguage, tier: "quality", segments, coverage, needsDeafReview: true };
}

// The auto draft track from build-sign output (a single looping concatenation per language). It is always
// the assistive tier and is publishable for non-hero content; hero content must upgrade to a human track.
export function draftSignTrack(signLanguage: string, draftUrl: string): SignTrack {
  return { signLanguage, tier: "draft", segments: [{ start: 0, end: 0, clipUrl: draftUrl }], coverage: 0, needsDeafReview: false };
}

// Hero publish gate: a hero title may publish a sign track only when it is the human quality tier, fully
// covers the transcript, and a Deaf reviewer has signed off.
export function publishableForHero(track: SignTrack, deafReviewDone: boolean): boolean {
  return track.tier === "quality" && track.coverage >= 0.999 && deafReviewDone;
}
