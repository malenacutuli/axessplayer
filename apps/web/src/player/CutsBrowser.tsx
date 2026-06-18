// 20-V6 PLAYER EXTRAS: the Cuts browser (the map icon). It lets the viewer SEE and SWITCH the cuts
// available to them for the current beat, switching seamlessly via the existing player swap (the host
// re-selects the on-screen variant). Owned premium cuts (from the wallet entitlements) are selectable;
// locked premium cuts open the "Unlock more of this story" sheet instead of dead-ending. Free cuts
// (calm / tense / POV / intensity / language) switch immediately.
//
// Events: cut_switched on any switch, plus the axis-specific pov_selected / intensity_selected when the
// chosen cut is a POV or intensity cut. Real states; a labelled modal dialog, keyboard reachable, Escape
// to close. No em dashes.

import { useCallback, useEffect, useRef } from "react";
import { CreditsPill } from "@axessplayer/ui";
import type { CutKind } from "../api/cuts.js";
import { LockIcon } from "../ui/icons.js";

// A cut the browser can present: a beat variant with a label, an axis kind, ownership, and a price when
// it is a locked premium cut. The host builds these from the content graph + wallet entitlements.
export interface BrowsableCut {
  variantId: string;
  label: string;
  // The merchandised axis when this is a premium story cut; "base" for the free engine/branch cuts.
  kind: CutKind | "base";
  isPremium: boolean;
  owned: boolean;
  coinCost: number;
  // True when this is the cut currently on screen.
  current: boolean;
}

export interface CutsBrowserProps {
  cuts: BrowsableCut[];
  // Switch to an owned / free cut (the existing player swap). The host re-selects the on-screen variant.
  onSwitch: (cut: BrowsableCut) => void;
  // A locked premium cut: route to the unlock sheet rather than dead-ending.
  onUnlock: (cut: BrowsableCut) => void;
  onClose: () => void;
}

const AXIS_LABEL: Record<CutKind | "base", string> = {
  base: "Cut",
  alt_ending: "Alternate ending",
  pov: "POV",
  intensity: "Intensity",
};

export function CutsBrowser({ cuts, onSwitch, onUnlock, onClose }: CutsBrowserProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = useCallback(
    (cut: BrowsableCut) => {
      if (cut.current) return;
      if (cut.isPremium && !cut.owned) {
        onUnlock(cut);
        return;
      }
      onSwitch(cut);
    },
    [onSwitch, onUnlock],
  );

  return (
    <div
      className="sheet up cutsbrowser"
      role="dialog"
      aria-modal="true"
      aria-label="Cuts available to you"
      data-testid="cuts-browser"
    >
      <div className="cutsheet__head">
        <h3 ref={headingRef} tabIndex={-1}>
          Cuts
        </h3>
        <button
          type="button"
          className="cutsheet__close"
          onClick={onClose}
          aria-label="Close"
          data-testid="cuts-browser-close"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <p className="cutsheet__sub">Switch the cut of this beat. Locked cuts open the unlock sheet.</p>

      <ul className="cutsbrowser__list" role="listbox" aria-label="Cuts">
        {cuts.map((cut) => {
          const locked = cut.isPremium && !cut.owned;
          return (
            <li key={cut.variantId}>
              <button
                type="button"
                role="option"
                aria-selected={cut.current}
                className={`cutsbrowser__item${cut.current ? " is-current" : ""}`}
                onClick={() => pick(cut)}
                data-testid={`cut-switch-${cut.variantId}`}
                data-kind={cut.kind}
                data-current={cut.current ? "true" : "false"}
              >
                <span className="cutsbrowser__item-main">
                  <span className="cutsbrowser__axis" data-kind={cut.kind}>
                    {AXIS_LABEL[cut.kind]}
                  </span>
                  <span className="cutsbrowser__label">{cut.label}</span>
                </span>
                {cut.current ? (
                  <span className="cutsbrowser__now" aria-hidden="true">
                    Now playing
                  </span>
                ) : locked ? (
                  <span className="cutsbrowser__locked">
                    <LockIcon stroke="currentColor" />
                    <CreditsPill amount={cut.coinCost} />
                  </span>
                ) : (
                  <span className="cutsbrowser__switch" aria-hidden="true">
                    Switch
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
