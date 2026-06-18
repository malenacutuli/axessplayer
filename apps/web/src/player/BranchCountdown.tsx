// 20-V6 PLAYER EXTRAS: the explicit-branch countdown UI ("YOUR MOVE"). On a branch-point beat the
// player shows a ring timer and two choices. A choice is a HIGH-INFORMATION signal, so the host emits
// branch_shown on display, branch_selected on the viewer's choice (and forwards the choice to the
// decision service via /decide recordSignals so it changes the path), and countdown_expired when the
// timer lapses and the engine picks the default. Doing nothing is a valid path: the engine decides.
//
// WCAG 2.2 AA: keyboard-operable (Tab to the choices, Enter / Space to choose, ArrowLeft / ArrowRight to
// move between them, the first choice is focused on show), announced via an aria-live region (the
// prompt and the seconds remaining at a coarse cadence), and the ring respects prefers-reduced-motion
// (no sweep animation, just a static remaining-time arc and the numeric readout). No em dashes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export interface BranchChoiceOption {
  // Stable id sent to /decide as the choice signal (e.g. "trust" / "walk_away").
  id: string;
  label: string;
}

export interface BranchCountdownProps {
  // The two (or more) choices. The first is focused on show.
  choices: BranchChoiceOption[];
  // Total countdown in milliseconds. The engine picks the default when it reaches zero.
  durationMs?: number;
  // Viewer picked a choice. The host emits branch_selected + forwards to /decide, then advances.
  onChoose: (choice: BranchChoiceOption, latencyMs: number) => void;
  // The timer lapsed with no choice. The host emits countdown_expired and lets the engine pick.
  onExpire: (latencyMs: number) => void;
  // A label for the branch moment, e.g. the beat line. Announced as context.
  prompt?: string;
}

const DEFAULT_DURATION_MS = 10000;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function BranchCountdown({
  choices,
  durationMs = DEFAULT_DURATION_MS,
  onChoose,
  onExpire,
  prompt,
}: BranchCountdownProps) {
  const startRef = useRef<number>(Date.now());
  const [remainingMs, setRemainingMs] = useState(durationMs);
  const decidedRef = useRef(false);
  const reduceMotion = useMemo(prefersReducedMotion, []);
  const buttonsRef = useRef<Array<HTMLButtonElement | null>>([]);

  // Tick the remaining time. On reaching zero, fire onExpire exactly once (the engine picks the default).
  useEffect(() => {
    startRef.current = Date.now();
    decidedRef.current = false;
    setRemainingMs(durationMs);
    const tick = () => {
      const elapsed = Date.now() - startRef.current;
      const left = Math.max(0, durationMs - elapsed);
      setRemainingMs(left);
      if (left <= 0 && !decidedRef.current) {
        decidedRef.current = true;
        onExpire(elapsed);
      }
    };
    const id = window.setInterval(tick, reduceMotion ? 500 : 80);
    return () => window.clearInterval(id);
  }, [durationMs, onExpire, reduceMotion]);

  // Focus the first choice on show, so a keyboard-only viewer can act immediately.
  useEffect(() => {
    buttonsRef.current[0]?.focus();
  }, []);

  const choose = useCallback(
    (choice: BranchChoiceOption) => {
      if (decidedRef.current) return;
      decidedRef.current = true;
      onChoose(choice, Date.now() - startRef.current);
    },
    [onChoose],
  );

  // ArrowLeft / ArrowRight roving focus between the choices (the choices are a single group).
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent, index: number) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        buttonsRef.current[(index + 1) % choices.length]?.focus();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        buttonsRef.current[(index - 1 + choices.length) % choices.length]?.focus();
      }
    },
    [choices.length],
  );

  const seconds = Math.ceil(remainingMs / 1000);
  const fraction = durationMs > 0 ? remainingMs / durationMs : 0;
  // Ring geometry: a 54px radius circle; the stroke-dashoffset encodes the remaining fraction.
  const R = 54;
  const CIRC = 2 * Math.PI * R;
  const dashOffset = CIRC * (1 - fraction);

  return (
    <div
      className={`branchmove${reduceMotion ? " branchmove--reduced" : ""}`}
      role="group"
      aria-label="Your move: choose what happens next"
      data-testid="branch-countdown"
    >
      {/* Coarse-cadence live region: the prompt plus the seconds remaining. assertive so the timer is
          heard, but we only announce whole seconds (the numeric text updates once per second) so a screen
          reader is not flooded. */}
      <div aria-live="assertive" className="sr-only" data-testid="branch-countdown-live">
        Your move. {prompt ? `${prompt}. ` : ""}
        {seconds} {seconds === 1 ? "second" : "seconds"} to choose, or the story decides for you.
      </div>

      <div className="branchmove__head">
        <span className="branchmove__title">YOUR MOVE</span>
        <div className="branchmove__ring" aria-hidden="true">
          <svg width="128" height="128" viewBox="0 0 128 128">
            <circle cx="64" cy="64" r={R} className="branchmove__ring-track" />
            <circle
              cx="64"
              cy="64"
              r={R}
              className="branchmove__ring-arc"
              strokeDasharray={CIRC}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 64 64)"
            />
          </svg>
          <span className="branchmove__seconds" data-testid="branch-countdown-seconds">
            {seconds}
          </span>
        </div>
      </div>

      {prompt && <p className="branchmove__prompt">{prompt}</p>}

      <div className="branchmove__choices">
        {choices.map((choice, i) => (
          <button
            key={choice.id}
            ref={(el) => {
              buttonsRef.current[i] = el;
            }}
            type="button"
            className="branchmove__choice"
            onClick={() => choose(choice)}
            onKeyDown={(e) => onKeyDown(e, i)}
            data-testid={`branch-choice-${choice.id}`}
          >
            {choice.label}
          </button>
        ))}
      </div>

      <p className="branchmove__hint" data-testid="branch-countdown-hint">
        Do nothing and the story decides for you.
      </p>
    </div>
  );
}
