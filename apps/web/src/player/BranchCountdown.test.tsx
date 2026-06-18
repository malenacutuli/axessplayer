// 20-V6 test: the "YOUR MOVE" branch countdown. A choice resolves via onChoose; doing nothing lets the
// timer lapse and resolves via onExpire (the engine picks). Keyboard-operable and announced via an
// aria-live region. No em dashes.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import { BranchCountdown, type BranchChoiceOption } from "./BranchCountdown.js";

const CHOICES: BranchChoiceOption[] = [
  { id: "calm", label: "Walk away" },
  { id: "tense", label: "Hold the line" },
];

describe("BranchCountdown", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the two choices, the ring, and the do-nothing hint", () => {
    render(<BranchCountdown choices={CHOICES} onChoose={() => {}} onExpire={() => {}} />);
    expect(screen.getByTestId("branch-countdown")).toBeInTheDocument();
    expect(screen.getByTestId("branch-choice-calm")).toHaveTextContent("Walk away");
    expect(screen.getByTestId("branch-choice-tense")).toHaveTextContent("Hold the line");
    expect(screen.getByTestId("branch-countdown-hint")).toHaveTextContent(/story decides for you/i);
  });

  it("has a live region announcing the countdown", () => {
    render(<BranchCountdown choices={CHOICES} prompt="Boardroom" onChoose={() => {}} onExpire={() => {}} />);
    const live = screen.getByTestId("branch-countdown-live");
    expect(live).toHaveAttribute("aria-live", "assertive");
    expect(live).toHaveTextContent(/your move/i);
  });

  it("resolves via onChoose when the viewer picks, exactly once", () => {
    const onChoose = vi.fn();
    const onExpire = vi.fn();
    render(<BranchCountdown choices={CHOICES} durationMs={10000} onChoose={onChoose} onExpire={onExpire} />);
    // fireEvent (not userEvent) so the click does not contend with the fake timer clock.
    fireEvent.click(screen.getByTestId("branch-choice-tense"));
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(onChoose.mock.calls[0][0]).toEqual({ id: "tense", label: "Hold the line" });
    // After a choice, letting the clock run does NOT also fire expire (one resolution per beat).
    act(() => vi.advanceTimersByTime(12000));
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("resolves via onExpire when the timer lapses with no choice (the engine picks)", () => {
    const onChoose = vi.fn();
    const onExpire = vi.fn();
    render(<BranchCountdown choices={CHOICES} durationMs={4000} onChoose={onChoose} onExpire={onExpire} />);
    act(() => vi.advanceTimersByTime(4200));
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onChoose).not.toHaveBeenCalled();
  });
});
