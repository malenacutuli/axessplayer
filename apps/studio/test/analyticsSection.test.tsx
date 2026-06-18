// Spec tests for SECTION 9 (Analytics). The load-bearing rules: a beat-level retention curve renders (with
// an accessible data-table mirror); branch/variant performance shows the off-policy counterfactual as a BAND
// (LiftBand, a range) NEVER a bare point (CORRECTIONS C6); completion, watch-time, the paywall funnel,
// ending distribution and cohort slices render; there is an export affordance; an empty series shows an
// empty state and an undeployed catalog shows a graceful empty state (no dead end). Hermetic stubbed fetch.
// No em dashes.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContentClient, type FeedSeries } from "../src/api/client.js";
import { ContentClientContext } from "../src/api/useContentClient.js";
import { CatalogClient } from "../src/api/catalogClient.js";
import { CatalogClientContext } from "../src/api/useCatalogClient.js";
import { AnalyticsSection } from "../src/components/studio/AnalyticsSection.js";
import type { SeriesAnalytics } from "../src/api/catalogTypes.js";

afterEach(cleanup);

const SID = "11111111-1111-1111-1111-111111111111";
const FEED: FeedSeries[] = [
  { id: SID, title: "The Last Signal", genre: "Thriller", cover_url: null, poster_url: null, published_at: "2026-06-01" },
];

const ANALYTICS: SeriesAnalytics = {
  seriesId: SID,
  seriesTitle: "The Last Signal",
  beatRetention: [
    { beatId: "beat-000001", retention: 1 },
    { beatId: "beat-000002", retention: 0.82 },
    { beatId: "beat-000003", retention: 0.61 },
  ],
  branchPerformance: [
    { branchId: "br-rooftop", label: "Rooftop cut", lift: { low: 0.04, high: 0.12, center: 0.08 } },
    { branchId: "br-tunnel", label: "Tunnel cut", lift: { low: -0.05, high: 0.03 } },
  ],
  endingDistribution: [
    { endingId: "end-reunion", label: "Reunion", share: 0.62 },
    { endingId: "end-sacrifice", label: "Sacrifice", share: 0.38 },
  ],
  funnel: [
    { step: "Reached paywall", count: 1200 },
    { step: "Viewed offer", count: 800 },
    { step: "Unlocked", count: 240 },
  ],
  completion: 0.57,
  watchTimeMs: 9 * 60000,
  byCohort: [
    { cohort: "en-US", completion: 0.6, watchTimeMs: 10 * 60000 },
    { cohort: "es-419", completion: 0.52, watchTimeMs: 8 * 60000 },
  ],
};

const EMPTY: SeriesAnalytics = {
  seriesId: SID,
  seriesTitle: "The Last Signal",
  beatRetention: [],
  branchPerformance: [],
  endingDistribution: [],
  funnel: [],
  completion: 0,
  watchTimeMs: 0,
  byCohort: [],
};

function makeFetch(analytics: SeriesAnalytics | "404") {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/feed") return json(200, { series: FEED });
    if (url.pathname.endsWith("/analytics")) {
      if (analytics === "404") return json(404, { error: "not_found" });
      return json(200, analytics);
    }
    return json(404, { error: "not_found" });
  }) as typeof fetch;
}

function renderAnalytics(analytics: SeriesAnalytics | "404") {
  const fetchImpl = makeFetch(analytics);
  const content = new ContentClient({ baseUrl: "http://content.test", fetchImpl });
  const catalog = new CatalogClient({ baseUrl: "http://catalog.test", token: "session:test", fetchImpl });
  render(
    <ContentClientContext.Provider value={content}>
      <CatalogClientContext.Provider value={catalog}>
        <AnalyticsSection />
      </CatalogClientContext.Provider>
    </ContentClientContext.Provider>,
  );
}

async function selectSeries(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByTestId("series-picker"), SID);
}

describe("AnalyticsSection section 9", () => {
  it("renders the retention curve with an accessible table mirror", async () => {
    const user = userEvent.setup();
    renderAnalytics(ANALYTICS);
    await selectSeries(user);
    expect(await screen.findByTestId("analytics-curve")).toBeInTheDocument();
    const table = screen.getByTestId("analytics-retention-table");
    expect(within(table).getByTestId("analytics-retention-beat-000002")).toHaveTextContent("82%");
  });

  it("shows branch performance as a BAND (a range), never a bare point", async () => {
    const user = userEvent.setup();
    renderAnalytics(ANALYTICS);
    await selectSeries(user);
    const row = await screen.findByTestId("analytics-branch-br-rooftop");
    // A LiftBand role=img with an aria-label that reads as a range.
    const band = within(row).getByRole("img");
    expect(band.getAttribute("aria-label")).toMatch(/to/);
    // The visible range is a span, not a single point.
    expect(screen.getByTestId("analytics-branch-range-br-rooftop")).toHaveTextContent(/\+4% to \+12%/);
  });

  it("renders completion, watch-time, funnel, ending distribution and cohort slices", async () => {
    const user = userEvent.setup();
    renderAnalytics(ANALYTICS);
    await selectSeries(user);
    expect(await screen.findByTestId("analytics-completion")).toHaveTextContent("57%");
    expect(screen.getByTestId("analytics-watchtime")).toHaveTextContent("9 min");
    expect(screen.getByTestId("analytics-ending-end-reunion")).toHaveTextContent("62%");
    expect(screen.getByTestId("analytics-funnel-reached-paywall")).toBeInTheDocument();
    expect(screen.getByTestId("analytics-cohort-en-us")).toBeInTheDocument();
  });

  it("offers an export affordance", async () => {
    const user = userEvent.setup();
    renderAnalytics(ANALYTICS);
    await selectSeries(user);
    expect(await screen.findByTestId("analytics-export")).toBeInTheDocument();
  });

  it("shows an empty state when there is no engagement", async () => {
    const user = userEvent.setup();
    renderAnalytics(EMPTY);
    await selectSeries(user);
    expect(await screen.findByTestId("analytics-empty")).toBeInTheDocument();
  });

  it("renders a graceful empty state when the analytics route is not deployed (no dead end)", async () => {
    const user = userEvent.setup();
    renderAnalytics("404");
    await selectSeries(user);
    expect(await screen.findByTestId("analytics-not-available")).toBeInTheDocument();
    expect(screen.getByTestId("analytics-retry")).toBeInTheDocument();
  });
});
