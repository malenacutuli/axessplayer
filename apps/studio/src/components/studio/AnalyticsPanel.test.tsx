// P8-T3 / C6 spec test for the Studio analytics panel: observed beat retention renders as measured rates,
// and the off-policy counterfactual renders ONLY as a band or inconclusive, never a bare point number.
// No em dashes.

import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, it, expect } from "vitest";
import { AnalyticsPanel, type BeatRetention } from "./AnalyticsPanel.js";

afterEach(cleanup);

const beats: BeatRetention[] = [
  { beatId: "2a000000-0000-0000-0000-0000000000b1", reached: 100, completed: 82, completionRate: 0.82 },
  { beatId: "2a000000-0000-0000-0000-0000000000b2", reached: 82, completed: 51, completionRate: 0.622 },
];

describe("AnalyticsPanel C6", () => {
  it("renders observed beat retention as measured rates", () => {
    render(<AnalyticsPanel beats={beats} />);
    expect(screen.getByTestId("retention-2a000000-0000-0000-0000-0000000000b1")).toHaveTextContent("82% completed (82/100)");
  });

  it("renders an off-policy counterfactual as a BAND, never a bare point", () => {
    render(<AnalyticsPanel beats={beats} counterfactual={{ kind: "uplift_band", text: "+4.0% to +12.0% vs the current cut", loPct: 0.04, hiPct: 0.12, direction: "up" }} />);
    const cf = screen.getByTestId("counterfactual");
    expect(cf).toHaveAttribute("data-kind", "uplift_band");
    expect(screen.getByTestId("counterfactual-text")).toHaveTextContent(/to/); // a range, not a single number
  });

  it("renders inconclusive when the estimate spans zero", () => {
    render(<AnalyticsPanel beats={beats} counterfactual={{ kind: "inconclusive", text: "No clear difference yet" }} />);
    expect(screen.getByTestId("counterfactual")).toHaveAttribute("data-kind", "inconclusive");
  });

  it("shows an empty state with no engagement", () => {
    render(<AnalyticsPanel beats={[]} />);
    expect(screen.getByTestId("analytics-empty")).toBeInTheDocument();
  });
});
