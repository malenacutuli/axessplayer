// 20-V6 test: the rail Like (optimistic toggle + count) and Share (Web Share API with clipboard
// fallback). No em dashes.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LikeButton, ShareButton } from "./RailActions.js";

describe("LikeButton", () => {
  it("optimistically toggles and increments the count, and emits the toggle", async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<LikeButton initialLiked={false} initialCount={12000} onToggle={onToggle} />);
    const btn = screen.getByTestId("player-like");
    expect(btn).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTestId("player-like-count")).toHaveTextContent("12k");
    await user.click(btn);
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(btn).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("player-like-count")).toHaveTextContent("12k");
  });

  it("rolls back the optimistic count when the toggle rejects", async () => {
    const onToggle = vi.fn(async () => {
      throw new Error("network");
    });
    const user = userEvent.setup();
    render(<LikeButton initialLiked={false} initialCount={5} onToggle={onToggle} />);
    const btn = screen.getByTestId("player-like");
    await user.click(btn);
    await waitFor(() => expect(btn).toHaveAttribute("aria-pressed", "false"));
    expect(screen.getByTestId("player-like-count")).toHaveTextContent("5");
  });
});

describe("ShareButton", () => {
  const realShare = (navigator as { share?: unknown }).share;
  const realClipboard = navigator.clipboard;
  afterEach(() => {
    Object.defineProperty(navigator, "share", { value: realShare, configurable: true });
    Object.defineProperty(navigator, "clipboard", { value: realClipboard, configurable: true });
  });

  it("uses the Web Share API when available", async () => {
    // userEvent.setup() installs its own clipboard stub, so set up the user FIRST, then override the
    // navigator surface this test needs.
    const user = userEvent.setup();
    const share = vi.fn(async () => {});
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    const onShared = vi.fn();
    render(<ShareButton title="Series" url="https://x/series/s1" onShared={onShared} />);
    await user.click(screen.getByTestId("player-share"));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(onShared).toHaveBeenCalledWith("web_share");
  });

  it("falls back to clipboard copy when no Web Share API", async () => {
    // userEvent.setup() installs its own clipboard stub, so set up the user FIRST, then override the
    // navigator surface (no Web Share API; a spy clipboard) this test asserts on.
    const user = userEvent.setup();
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const onShared = vi.fn();
    render(<ShareButton title="Series" url="https://x/series/s1" onShared={onShared} />);
    await user.click(screen.getByTestId("player-share"));
    await waitFor(() => expect(onShared).toHaveBeenCalledWith("clipboard"));
    expect(writeText).toHaveBeenCalledWith("https://x/series/s1");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });
});
