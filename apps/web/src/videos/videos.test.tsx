// Watch page and home rows render real video metadata: sponsor disclosure, accessibility state, and
// shape-aware tiles. The client is a fake; no network. No em dashes.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Watch } from "./Watch.js";
import { VideoRows } from "./VideoRows.js";
import type { Video, VideosClient } from "./api.js";

const base: Video = {
  id: "v1",
  title: "Cooking with captions",
  description: "A recipe.",
  channel: { id: "c1", name: "Chef Ana" },
  orientation: "horizontal",
  width: 1920,
  height: 1080,
  duration_ms: 125_000,
  format: "long",
  language: "en",
  category: "food",
  thumbnail_url: null,
  published_at: "2026-10-01T10:00:00.000Z",
  views: 1200,
  accessibility: { captions: true, audio_description: true, sign: false, dubs: ["es"] },
  sponsor: { brand: "Olive Co", disclosure: "Sponsored by Olive Co" },
};

const client = (videos: Video[]): VideosClient => ({
  async home() {
    return { rows: [{ id: "new", title: "New", items: videos }] };
  },
  async shorts() {
    return { items: [], next_cursor: null };
  },
  async get(id) {
    const v = videos.find((x) => x.id === id);
    if (!v) throw new Error("404");
    return v;
  },
  async playback() {
    return { playback_url: "https://customer-x.cloudflarestream.com/token/manifest/video.m3u8" };
  },
});

describe("Watch", () => {
  it("shows the title, channel, sponsor disclosure, and accessibility state", async () => {
    render(<Watch videoId="v1" client={client([base])} onBack={() => {}} />);
    expect(await screen.findByRole("heading", { name: "Cooking with captions" })).toBeInTheDocument();
    expect(screen.getByText("Chef Ana")).toBeInTheDocument();
    expect(screen.getByTestId("sponsor-card")).toHaveTextContent("Sponsored by Olive Co");
    expect(screen.getByRole("button", { name: "Captions on" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Audio description")).toBeInTheDocument();
    expect(screen.getByText("Dubbed: es")).toBeInTheDocument();
  });
  it("says so when a video is not available", async () => {
    render(<Watch videoId="missing" client={client([base])} onBack={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("not available");
  });
});

describe("VideoRows", () => {
  it("renders rows with shape-aware tiles and accessibility badges", async () => {
    const tall: Video = { ...base, id: "v2", title: "A short", orientation: "vertical", width: 1080, height: 1920, format: "short", sponsor: null };
    render(<VideoRows client={client([base, tall])} onOpenVideo={() => {}} onOpenShorts={() => {}} />);
    expect(await screen.findByRole("heading", { name: "New" })).toBeInTheDocument();
    const tiles = screen.getAllByRole("listitem");
    expect(tiles).toHaveLength(2);
    expect(tiles[1].className).toContain("vtile--tall");
    expect(tiles[0]).toHaveTextContent("CC AD");
  });
});
