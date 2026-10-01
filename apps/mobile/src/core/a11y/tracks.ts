// Accessibility tray logic. Cloudflare Stream embeds WebVTT captions in the HLS manifest, which expo-video
// exposes as subtitle tracks. Captions are ON by default: pickSubtitleTrack chooses the best track for the
// viewer's languages (exact tag, then base language, then the video's own language, then the first
// track). badgesFor turns the video's accessibility block into labeled badges for the tray. No em dashes.

import type { Video, VideoAccessibility } from "../api/types";

export interface TextTrackLike {
  id?: string;
  language: string;
  label: string;
}

export function baseLang(tag: string): string {
  return tag.toLowerCase().split(/[-_]/)[0] ?? "";
}

export function pickSubtitleTrack<T extends TextTrackLike>(
  tracks: readonly T[],
  enabled: boolean,
  preferred: readonly string[],
  videoLanguage?: string
): T | null {
  if (!enabled || tracks.length === 0) return null;
  const wanted = [...preferred, ...(videoLanguage ? [videoLanguage] : [])].filter(Boolean);
  for (const w of wanted) {
    const exact = tracks.find((t) => t.language.toLowerCase() === w.toLowerCase());
    if (exact) return exact;
  }
  for (const w of wanted) {
    const b = baseLang(w);
    const loose = tracks.find((t) => baseLang(t.language) === b);
    if (loose) return loose;
  }
  return tracks[0] ?? null;
}

export function sameTrack(a: TextTrackLike | null | undefined, b: TextTrackLike | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a.id && b.id) return a.id === b.id;
  return a.language === b.language && a.label === b.label;
}

export function languageName(tag: string, displayLocale = "en"): string {
  try {
    const DN = (Intl as unknown as { DisplayNames?: new (l: string[], o: { type: string }) => { of(c: string): string | undefined } }).DisplayNames;
    if (DN) {
      const name = new DN([displayLocale], { type: "language" }).of(tag);
      if (name && name !== tag) return name;
    }
  } catch {
    // fall through
  }
  return tag.toUpperCase();
}

export interface A11yBadge {
  key: "captions" | "audio_description" | "sign" | "dubs";
  short: string;
  label: string;
}

export function badgesFor(a: VideoAccessibility, displayLocale = "en"): A11yBadge[] {
  const out: A11yBadge[] = [];
  if (a.captions) out.push({ key: "captions", short: "CC", label: "Captions available" });
  if (a.audio_description) out.push({ key: "audio_description", short: "AD", label: "Audio description available" });
  if (a.sign) out.push({ key: "sign", short: "Sign", label: "Sign language available" });
  if (a.dubs.length > 0) {
    const names = a.dubs.map((d) => languageName(d, displayLocale));
    out.push({ key: "dubs", short: `Dubs ${a.dubs.length}`, label: `Dubbed in ${names.join(", ")}` });
  }
  return out;
}

export interface SponsorDisclosure {
  heading: string;
  body: string;
  accessibilityLabel: string;
}

// FTC endorsement guides and EU AI Act Article 50 / DSA style transparency: a clear, labeled card, never
// hidden behind a tap. Returns null when the video has no sponsor.
export function sponsorDisclosure(v: Pick<Video, "sponsor">): SponsorDisclosure | null {
  if (!v.sponsor) return null;
  const heading = `Sponsored by ${v.sponsor.brand}`;
  const body = v.sponsor.disclosure;
  return { heading, body, accessibilityLabel: `Advertising disclosure. ${heading}. ${body}` };
}

export function formatDuration(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function durationLabel(ms: number | null): string | null {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return null;
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s} seconds`;
  return s === 0 ? `${m} minutes` : `${m} minutes ${s} seconds`;
}
