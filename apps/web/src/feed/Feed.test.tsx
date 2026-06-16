// Component test for the "For you" feed. It renders REAL published series from GET /feed (0009b): a card per
// item with the "Adapts to you" badge and genre caption, the gold coins pill, the generated poster when
// present (0009c), and opens the player by series id when a card is chosen. An empty feed shows the empty
// state. Keyboard and listbox semantics keep it usable without a pointer. No em dashes.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Feed } from "./Feed.js";
import type { FeedItem } from "../api/content.js";
import { SERIES_ID } from "../test/fixtures.js";

function feedItem(over: Partial<FeedItem> = {}): FeedItem {
  return {
    id: SERIES_ID,
    title: "The Last Signal",
    genre: "thriller",
    cover_url: null,
    poster_url: null,
    base_language: "en",
    available_languages: ["en"],
    published_at: "2026-06-15T19:48:23.885Z",
    ...over,
  };
}

describe("Feed", () => {
  it("renders a published series card with its badge and caption", () => {
    render(<Feed feed={[feedItem()]} onOpen={() => {}} coins={10} />);
    expect(screen.getByText("The Last Signal")).toBeInTheDocument();
    expect(screen.getByText("Adapts to you")).toBeInTheDocument();
    expect(screen.getByText(/Thriller/)).toBeInTheDocument();
  });

  it("shows the gold coins pill with the live balance", () => {
    render(<Feed feed={[feedItem()]} onOpen={() => {}} coins={10} />);
    expect(screen.getByTestId("feed-coins")).toHaveTextContent("10");
  });

  it("opens the player by series id when a card is chosen", async () => {
    const onOpen = vi.fn();
    render(<Feed feed={[feedItem()]} onOpen={onOpen} coins={10} />);
    await userEvent.click(screen.getByTestId(`feed-open-${SERIES_ID}`));
    expect(onOpen).toHaveBeenCalledWith(SERIES_ID);
  });

  it("renders the generated poster when present", () => {
    render(<Feed feed={[feedItem({ poster_url: "http://127.0.0.1:8095/posters/x.png" })]} onOpen={() => {}} coins={10} />);
    expect(screen.getByTestId(`feed-poster-${SERIES_ID}`)).toHaveAttribute(
      "data-poster-url",
      "http://127.0.0.1:8095/posters/x.png",
    );
  });

  it("shows the empty state when nothing is published", () => {
    render(<Feed feed={[]} onOpen={() => {}} coins={10} />);
    expect(screen.getByTestId("feed-empty")).toBeInTheDocument();
  });

  it("exposes a listbox role for assistive technology", () => {
    render(<Feed feed={[feedItem()]} onOpen={() => {}} coins={10} />);
    expect(screen.getByRole("listbox", { name: /published series/i })).toBeInTheDocument();
  });
});
