// Platform v2 content contract (free, accessible-by-default creator video). These shapes mirror the
// content service endpoints being built now (/feed/shorts, /feed/home, /videos/:id, /videos/:id/playback).
// They are not yet in contracts/api/content.yaml, so they live here and are parsed defensively in
// parse.ts. When the frozen contract lands, alias these to the generated codegen. No em dashes.

export type Orientation = "vertical" | "horizontal" | "square";
export type VideoFormat = "short" | "long";

export interface VideoAccessibility {
  captions: boolean;
  audio_description: boolean;
  sign: boolean;
  // BCP 47 language tags of dubbed audio tracks.
  dubs: string[];
}

export interface Sponsor {
  brand: string;
  disclosure: string;
}

export interface Channel {
  id: string;
  name: string;
}

export interface Video {
  id: string;
  title: string;
  description: string | null;
  channel: Channel;
  orientation: Orientation;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  format: VideoFormat;
  language: string;
  category: string | null;
  thumbnail_url: string | null;
  published_at: string;
  accessibility: VideoAccessibility;
  sponsor: Sponsor | null;
}

export interface ShortsPage {
  items: Video[];
  next_cursor: string | null;
}

export interface HomeRow {
  id: string;
  title: string;
  items: Video[];
}

export interface HomeFeed {
  rows: HomeRow[];
}

export interface Playback {
  playback_url: string;
}
