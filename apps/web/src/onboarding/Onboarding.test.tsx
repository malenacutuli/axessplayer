// 20-V1 cold open flow test. Three taps (pace, POV, intensity) advance a 3-step progress, then POST
// /calibrate, then the payoff card with the CUT FOR YOU badge and Play episode 1. We assert the calibrate
// body and that the calibration breadcrumbs are emitted. No em dashes.

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Onboarding } from "./Onboarding.js";
import type { CatalogClient } from "../api/catalog.js";
import type { ViewerAnalytics } from "../analytics/analytics.js";

function stubCatalog(calibrate = vi.fn(async () => ({ summary: "slow burn, your POV, English", badge: "CUT FOR YOU" }))): {
  client: CatalogClient;
  calibrate: typeof calibrate;
} {
  const client: CatalogClient = {
    calibrate,
    getContinue: vi.fn(async () => []),
    getTrending: vi.fn(async () => []),
    getSeriesDetail: vi.fn(),
    search: vi.fn(async () => ({ shows: [], characters: [], channels: [] })),
  };
  return { client, calibrate };
}

describe("Onboarding cold open", () => {
  it("walks the three taps, calibrates, and shows the payoff with Play", async () => {
    const { client, calibrate } = stubCatalog();
    const tracked: string[] = [];
    const analytics: ViewerAnalytics = { track: (name) => tracked.push(name) };
    const onPlay = vi.fn();

    render(<Onboarding catalog={client} analytics={analytics} seriesId="s1" onPlay={onPlay} />);

    // Step 1: pace
    fireEvent.click(screen.getByTestId("onboarding-pace-slow_burn"));
    // Step 2: pov
    fireEvent.click(screen.getByTestId("onboarding-pov-protagonist"));
    // Step 3: intensity (0.6 = balanced) -> triggers calibrate
    fireEvent.click(screen.getByTestId("onboarding-intensity-0.6"));

    await waitFor(() => expect(screen.getByTestId("onboarding-ready")).toBeInTheDocument());

    expect(calibrate).toHaveBeenCalledWith({ pace: "slow_burn", pov: "protagonist", intensity: 0.6 });
    expect(screen.getByText("CUT FOR YOU")).toBeInTheDocument();
    expect(tracked).toContain("pov_selected");
    expect(tracked).toContain("intensity_selected");
    expect(tracked).toContain("cut_switched");

    fireEvent.click(screen.getByTestId("onboarding-play"));
    expect(onPlay).toHaveBeenCalled();
    expect(tracked).toContain("series_opened");
  });

  it("surfaces a retryable error when calibrate fails", async () => {
    const calibrate = vi.fn(async () => {
      throw new Error("network down");
    });
    const { client } = stubCatalog(calibrate);
    const analytics: ViewerAnalytics = { track: vi.fn() };

    render(<Onboarding catalog={client} analytics={analytics} seriesId="s1" onPlay={vi.fn()} />);
    fireEvent.click(screen.getByTestId("onboarding-pace-tense"));
    fireEvent.click(screen.getByTestId("onboarding-pov-observer"));
    fireEvent.click(screen.getByTestId("onboarding-intensity-0.9"));

    await waitFor(() => expect(screen.getByText(/We could not tune your cut/)).toBeInTheDocument());
  });
});
