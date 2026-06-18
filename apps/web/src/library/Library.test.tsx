// 20-V4 LIBRARY tests. The tabs render their own loading / empty / error / ready states, Saved unsave
// hits the library client and re-reads, the Downloads tab carries the honest fixed-cut note, and the
// canonical events fire. Identity is the session subject; the stub client never receives a user_id.
// No em dashes.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Library } from "./Library.js";
import type {
  LibraryClient,
  SavedItem,
  DownloadItem,
  HistoryItem,
  FavoriteItem,
} from "../api/library.js";
import type { ViewerAnalytics } from "../analytics/analytics.js";

function stubLibrary(overrides: Partial<LibraryClient> = {}): LibraryClient {
  return {
    getSaved: vi.fn(async () => [] as SavedItem[]),
    saveSeries: vi.fn(async () => {}),
    unsaveSeries: vi.fn(async () => {}),
    getFavorites: vi.fn(async () => [] as FavoriteItem[]),
    addFavorite: vi.fn(async () => {}),
    removeFavorite: vi.fn(async () => {}),
    getDownloads: vi.fn(async () => [] as DownloadItem[]),
    startDownload: vi.fn(async () => {}),
    setDownloadStatus: vi.fn(async () => {}),
    getHistory: vi.fn(async () => [] as HistoryItem[]),
    getChannelFollows: vi.fn(async () => []),
    followChannel: vi.fn(async () => {}),
    unfollowChannel: vi.fn(async () => {}),
    ...overrides,
  };
}

function trackingAnalytics(): { analytics: ViewerAnalytics; events: string[] } {
  const events: string[] = [];
  return { analytics: { track: (name) => events.push(name) }, events };
}

const noop = () => {};

describe("Library (20-V4)", () => {
  it("shows the empty Saved state when nothing is saved", async () => {
    const { analytics } = trackingAnalytics();
    render(
      <Library
        library={stubLibrary()}
        analytics={analytics}
        onBack={noop}
        onOpenSeries={noop}
        onResume={noop}
      />,
    );
    expect(await screen.findByText("Nothing saved yet")).toBeInTheDocument();
  });

  it("lists saved shows and unsaves with a canonical event + re-read", async () => {
    const saved: SavedItem[] = [
      { seriesId: "s1", title: "The Last Signal", poster: null, createdAt: "2026-06-01T00:00:00Z" },
    ];
    const getSaved = vi
      .fn<() => Promise<SavedItem[]>>()
      .mockResolvedValueOnce(saved) // initial
      .mockResolvedValueOnce([]); // after unsave re-read
    const unsaveSeries = vi.fn(async () => {});
    const lib = stubLibrary({ getSaved, unsaveSeries });
    const { analytics, events } = trackingAnalytics();

    render(
      <Library library={lib} analytics={analytics} onBack={noop} onOpenSeries={noop} onResume={noop} />,
    );

    fireEvent.click(await screen.findByTestId("saved-unsave-s1"));

    await waitFor(() => expect(unsaveSeries).toHaveBeenCalledWith("s1"));
    expect(events).toContain("unsave");
    await waitFor(() => expect(screen.getByText("Nothing saved yet")).toBeInTheDocument());
  });

  it("carries the honest fixed-cut note on the Downloads tab and emits offline_watched", async () => {
    const downloads: DownloadItem[] = [
      {
        seriesId: "s1",
        title: "The Last Signal",
        poster: null,
        episodeIds: ["e1", "e2"],
        bytes: 734003200,
        status: "ready",
        createdAt: "2026-06-01T00:00:00Z",
      },
    ];
    const lib = stubLibrary({ getDownloads: vi.fn(async () => downloads) });
    const { analytics, events } = trackingAnalytics();

    render(
      <Library
        library={lib}
        analytics={analytics}
        initialTab="downloads"
        onBack={noop}
        onOpenSeries={noop}
        onResume={noop}
      />,
    );

    expect(await screen.findByTestId("downloads-note")).toHaveTextContent("fixed cut");
    fireEvent.click(await screen.findByTestId("download-watch-s1"));
    expect(events).toContain("offline_watched");
  });

  it("resumes from history with continue_resumed", async () => {
    const history: HistoryItem[] = [
      { seriesId: "s1", title: "The Last Signal", poster: null, episodeId: "e1", watchedAt: "2026-06-10T00:00:00Z" },
    ];
    const lib = stubLibrary({ getHistory: vi.fn(async () => history) });
    const { analytics, events } = trackingAnalytics();
    const onResume = vi.fn();

    render(
      <Library
        library={lib}
        analytics={analytics}
        initialTab="history"
        onBack={noop}
        onOpenSeries={noop}
        onResume={onResume}
      />,
    );

    fireEvent.click(await screen.findByTestId("history-resume-s1"));
    expect(onResume).toHaveBeenCalledWith("s1");
    expect(events).toContain("continue_resumed");
  });

  it("renders an error state with a retry when the favorites load fails", async () => {
    const lib = stubLibrary({ getFavorites: vi.fn(async () => Promise.reject(new Error("boom"))) });
    const { analytics } = trackingAnalytics();

    render(
      <Library
        library={lib}
        analytics={analytics}
        initialTab="favorites"
        onBack={noop}
        onOpenSeries={noop}
        onResume={noop}
      />,
    );

    expect(await screen.findByText("Could not load your favorites")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
