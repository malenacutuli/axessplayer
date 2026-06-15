// Component test for the vertical swipe feed. It renders episodes from the content graph, advances on
// keyboard navigation, and opens the player on selection. No em dashes.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Feed } from "./Feed.js";
import { seedGraph } from "../test/fixtures.js";
import type { SeriesGraph } from "../api/content.js";

function twoEpisodeGraph(): SeriesGraph {
  const g = seedGraph();
  g.episodes = [
    g.episodes[0],
    { ...g.episodes[0], id: "22222222-2222-2222-2222-222222222223", episode_number: 2, title: "Aftermath", is_free: false, coin_cost: 3 },
  ];
  return g;
}

describe("Feed", () => {
  it("renders the first episode and its free tag", () => {
    render(<Feed graph={seedGraph()} onOpen={() => {}} />);
    expect(screen.getByText("Pilot")).toBeInTheDocument();
    expect(screen.getByText("Free")).toBeInTheDocument();
  });

  it("calls onOpen with the active episode when Watch is pressed", async () => {
    const onOpen = vi.fn();
    render(<Feed graph={seedGraph()} onOpen={onOpen} />);
    await userEvent.click(screen.getByTestId("feed-open-22222222-2222-2222-2222-222222222222"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0][0].title).toBe("Pilot");
  });

  it("swipes to the next episode with the Down control", async () => {
    render(<Feed graph={twoEpisodeGraph()} onOpen={() => {}} />);
    expect(screen.getByText("Pilot")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Next episode" }));
    expect(screen.getByText("Aftermath")).toBeVisible();
    expect(screen.getByText("3 coins")).toBeInTheDocument();
  });

  it("navigates with the keyboard (ArrowDown then ArrowUp)", async () => {
    render(<Feed graph={twoEpisodeGraph()} onOpen={() => {}} />);
    const feed = screen.getByTestId("feed");
    feed.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByText("Aftermath")).toBeVisible();
    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByText("Pilot")).toBeVisible();
  });

  it("exposes a listbox role for assistive technology", () => {
    render(<Feed graph={seedGraph()} onOpen={() => {}} />);
    expect(screen.getByRole("listbox", { name: /episodes/i })).toBeInTheDocument();
  });
});
