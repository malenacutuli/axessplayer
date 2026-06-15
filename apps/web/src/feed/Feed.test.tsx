// Component test for the "For you" feed. It renders the real series as the first story card (with the
// "Adapts to you" badge, genre/episode caption, and the gold coins pill), opens the player when the
// real card is chosen, and keeps the prototype's placeholder cards inert. Keyboard and listbox
// semantics keep it usable without a pointer. No em dashes.

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Feed } from "./Feed.js";
import { seedGraph, SERIES_ID } from "../test/fixtures.js";

describe("Feed", () => {
  it("renders the real series card with its badge and caption", () => {
    render(<Feed graph={seedGraph()} onOpen={() => {}} coins={10} />);
    expect(screen.getByText("The Last Signal")).toBeInTheDocument();
    expect(screen.getByText("Adapts to you")).toBeInTheDocument();
    // Genre (capitalized) + episode + chapter count caption.
    expect(screen.getByText(/Thriller · Ep 1 · 5 ch/)).toBeInTheDocument();
  });

  it("shows the gold coins pill with the live balance", () => {
    render(<Feed graph={seedGraph()} onOpen={() => {}} coins={10} />);
    expect(screen.getByTestId("feed-coins")).toHaveTextContent("10");
  });

  it("opens the player when the real series card is chosen", async () => {
    const onOpen = vi.fn();
    render(<Feed graph={seedGraph()} onOpen={onOpen} coins={10} />);
    await userEvent.click(screen.getByTestId(`feed-open-${SERIES_ID}`));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("keeps the prototype placeholder cards inert (no player open)", async () => {
    const onOpen = vi.fn();
    render(<Feed graph={seedGraph()} onOpen={onOpen} coins={10} />);
    expect(screen.getByText("Five Years to Burn It Down")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("feed-open-placeholder-burn"));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("exposes a listbox role for assistive technology", () => {
    render(<Feed graph={seedGraph()} onOpen={() => {}} coins={10} />);
    expect(screen.getByRole("listbox", { name: /and more/i })).toBeInTheDocument();
  });
});
