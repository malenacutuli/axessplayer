// C10 spec test: meaning never depends on color alone. The speaker NAME tag is always rendered for
// dialogue (the redundant non-color cue), and character color is a controllable enhancement over a
// compliant white default. No em dashes.

import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, it, expect } from "vitest";
import { CaptionsWithIntention } from "./CaptionsWithIntention.js";
import type { CaptionSegment } from "./captionsModel.js";

// jsdom does not implement canvas text metrics; stub measureText so the captions fitter can paginate.
beforeAll(() => {
  (HTMLCanvasElement.prototype as unknown as { getContext: () => unknown }).getContext = () => ({
    font: "",
    measureText: (t: string) => ({ width: t.length * 8 }),
  });
});

afterEach(cleanup);

function seg(over: Partial<CaptionSegment> = {}): CaptionSegment {
  return {
    speaker: "VALENTINA",
    speakerColor: "#FF6FA5",
    type: "dialogue",
    startTime: 0,
    endTime: 3,
    words: [{ text: "Hello", startTime: 0, endTime: 1, energy_rms: 0.03, f0_hz: 200, harmonic_ratio: 0.5 } as never],
    ...over,
  } as CaptionSegment;
}

describe("CaptionsWithIntention C10 compliance", () => {
  it("always renders the speaker name tag for dialogue (redundant non-color attribution cue)", () => {
    render(<CaptionsWithIntention segments={[seg()]} currentTimeMs={500} enabled />);
    expect(screen.getByTestId("captions-speaker")).toHaveTextContent("VALENTINA");
  });

  it("applies the character color when colorEnabled (enhancement)", () => {
    render(<CaptionsWithIntention segments={[seg()]} currentTimeMs={500} enabled colorEnabled />);
    expect(screen.getByTestId("captions-speaker")).toHaveStyle({ color: "rgb(255, 111, 165)" });
  });

  it("falls back to compliant white when colorEnabled is false, name tag still present", () => {
    render(<CaptionsWithIntention segments={[seg()]} currentTimeMs={500} enabled colorEnabled={false} />);
    const tag = screen.getByTestId("captions-speaker");
    expect(tag).toHaveTextContent("VALENTINA");
    expect(tag).toHaveStyle({ color: "rgb(255, 255, 255)" });
  });

  it("does not show a speaker tag for sound effects", () => {
    render(<CaptionsWithIntention segments={[seg({ type: "soundeffect", speaker: "" })]} currentTimeMs={500} enabled />);
    expect(screen.queryByTestId("captions-speaker")).toBeNull();
  });
});
