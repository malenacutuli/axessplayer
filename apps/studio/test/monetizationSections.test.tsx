// Spec tests for SECTIONS 7 (Posters and marketing), 10 (Monetization and revenue share), and 11 (Modify
// content). Load-bearing rules:
//  - Posters: generation calls the EXISTING content poster endpoint; every asset carries the C2PA + Article
//    50 provenance label; the "push to UA testing" and marketing-creatives actions are cost/RBAC-gated
//    coming-soon seams that NEVER fake success.
//  - Monetization: the 70/30 split is computed and shown transparently per source and in aggregate; a Stripe
//    TEST badge and no-live-charge note are present; an undeployed catalog degrades to a graceful empty.
//  - Modify content: every destructive action opens a confirmation dialog stating versioning/provenance is
//    preserved; unwired actions are clearly-labelled coming-soon seams (no fabricated success).
// Hermetic stubbed fetch; no live services. No em dashes.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContentClient, type FeedSeries } from "../src/api/client.js";
import { ContentClientContext } from "../src/api/useContentClient.js";
import { CatalogClient } from "../src/api/catalogClient.js";
import { CatalogClientContext } from "../src/api/useCatalogClient.js";
import { PostersMarketingSection } from "../src/components/studio/PostersMarketingSection.js";
import { MonetizationSection } from "../src/components/studio/MonetizationSection.js";
import { ModifyContentSection } from "../src/components/studio/ModifyContentSection.js";
import type { SeriesRevenue } from "../src/api/catalogTypes.js";

afterEach(cleanup);

const SID = "11111111-1111-1111-1111-111111111111";
const FEED: FeedSeries[] = [
  { id: SID, title: "The Last Signal", genre: "Thriller", cover_url: null, poster_url: null, published_at: "2026-06-01" },
];

const GRAPH = {
  series: { id: SID, title: "The Last Signal", base_language: "en", published_at: "2026-06-01", poster_url: null },
  episodes: [
    {
      id: "ep-1",
      episode_number: 1,
      title: "Pilot",
      beats: [
        {
          id: "beat-1",
          beat_index: 0,
          role: "ending",
          is_branch_point: false,
          canon_facts: {},
          variants: [
            { id: "var-premium-1", language: "en", accessibility: {}, intensity: null, pov: null, tier: "A_filmed", is_premium: true, coin_cost: 12, playback_url: "x", duration_ms: 1000, qa_status: "passed" },
          ],
        },
      ],
    },
  ],
  edges: [],
};

const REVENUE: SeriesRevenue = {
  bySource: [
    { source: "premium_unlock", gross: 1000, creatorShare: 700, platformShare: 300 },
    { source: "rewarded_ad", gross: 200, creatorShare: 140, platformShare: 60 },
  ],
  totalGross: 1200,
  creator70: 840,
  platform30: 360,
  payoutBalance: 540,
  byEpisode: [{ episodeId: "ep-1", label: "Pilot", gross: 1200, creatorShare: 840, platformShare: 360 }],
  byCohort: [{ cohort: "en-US", gross: 800, creatorShare: 560, platformShare: 240 }],
};

function makeFetch(opts?: { revenue?: SeriesRevenue | "404"; posterFail?: boolean }) {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = (init?.method ?? "GET").toUpperCase();
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/feed" || url.pathname === "/series") return json(200, { series: FEED });
    if (url.pathname.endsWith("/graph")) return json(200, GRAPH);
    if (url.pathname.endsWith("/revenue")) {
      if (opts?.revenue === "404") return json(404, { error: "not_found" });
      return json(200, opts?.revenue ?? REVENUE);
    }
    if (url.pathname.endsWith("/poster/generate")) {
      if (opts?.posterFail) return json(501, { error: "stability_not_configured" });
      return json(200, { id: SID, poster_url: "https://cdn.test/poster.png" });
    }
    if (url.pathname === "/variants" && method === "POST") return json(201, { id: "var-new-1" });
    if (url.pathname.startsWith("/variants/") && method === "DELETE") return json(200, { id: "var-premium-1", deleted: true });
    if (url.pathname.endsWith("/unpublish")) return json(200, { id: SID, published_at: null });
    return json(404, { error: "not_found" });
  }) as typeof fetch;
}

function providers(children: React.ReactNode, fetchImpl: typeof fetch) {
  const content = new ContentClient({ baseUrl: "http://content.test", fetchImpl });
  const catalog = new CatalogClient({ baseUrl: "http://catalog.test", token: "session:test", fetchImpl });
  return render(
    <ContentClientContext.Provider value={content}>
      <CatalogClientContext.Provider value={catalog}>{children}</CatalogClientContext.Provider>
    </ContentClientContext.Provider>,
  );
}

async function pickSeries(user: ReturnType<typeof userEvent.setup>) {
  const picker = await screen.findByTestId("series-picker");
  await user.selectOptions(picker, SID);
}

describe("Section 7 - Posters and marketing", () => {
  it("generates via the existing content endpoint and labels every asset with provenance", async () => {
    const user = userEvent.setup();
    providers(<PostersMarketingSection />, makeFetch());
    await pickSeries(user);
    expect(await screen.findByTestId("posters-generate")).toBeEnabled();
    await user.click(screen.getByTestId("posters-generate"));
    // A candidate appears with a C2PA + Article 50 provenance label.
    const grid = await screen.findByTestId("posters-grid");
    expect(within(grid).getAllByText(/Article 50/i).length).toBeGreaterThan(0);
  });

  it("surfaces a not-configured error instead of faking a poster", async () => {
    const user = userEvent.setup();
    providers(<PostersMarketingSection />, makeFetch({ posterFail: true }));
    await pickSeries(user);
    await user.click(await screen.findByTestId("posters-generate"));
    expect(await screen.findByTestId("posters-error")).toHaveTextContent(/not configured/i);
  });

  it("push-to-UA-testing is a gated coming-soon seam that does not fake success", async () => {
    const user = userEvent.setup();
    providers(<PostersMarketingSection />, makeFetch());
    await pickSeries(user);
    await user.click(await screen.findByTestId("posters-generate"));
    await screen.findByTestId("posters-grid");
    // Gated until a winner is marked.
    expect(screen.getByTestId("posters-push-ua")).toBeDisabled();
    const markBtns = screen.getAllByTestId(/posters-mark-winner-/);
    await user.click(markBtns[0]);
    await user.click(screen.getByTestId("posters-push-ua"));
    expect(await screen.findByTestId("posters-ua-comingsoon")).toHaveTextContent(/coming soon/i);
  });

  it("cost-gates the marketing creatives action", async () => {
    const user = userEvent.setup();
    providers(<PostersMarketingSection />, makeFetch());
    await pickSeries(user);
    expect(await screen.findByTestId("creatives-cost")).toBeInTheDocument();
    await user.click(screen.getByTestId("creatives-confirm"));
    await user.click(await screen.findByTestId("creatives-run"));
    expect(await screen.findByTestId("creatives-comingsoon")).toHaveTextContent(/no spend/i);
  });
});

describe("Section 10 - Monetization and revenue share", () => {
  it("shows the Stripe TEST badge and a computed, transparent 70/30 split", async () => {
    const user = userEvent.setup();
    providers(<MonetizationSection />, makeFetch());
    expect(screen.getByTestId("monetization-stripe-test")).toHaveTextContent(/TEST/);
    await pickSeries(user);
    // Revenue body with the aggregate split.
    await screen.findByTestId("monetization-revenue-body");
    expect(screen.getByTestId("monetization-split-check")).toHaveTextContent(/70%/);
    expect(screen.getByTestId("monetization-split-check")).toHaveTextContent(/840/);
    expect(screen.getByTestId("monetization-split-check")).toHaveTextContent(/360/);
    // By-source table shows per-source creator/platform shares.
    expect(screen.getByTestId("monetization-by-source")).toBeInTheDocument();
    // No-live-charge note.
    expect(screen.getByTestId("monetization-payout-note")).toHaveTextContent(/no live charge/i);
  });

  it("applies a one-click preset and saves the premium price via the content endpoint", async () => {
    const user = userEvent.setup();
    providers(<MonetizationSection />, makeFetch());
    await pickSeries(user);
    await user.click(await screen.findByTestId("monetization-preset-premium"));
    await user.click(screen.getByTestId("monetization-save"));
    expect(await screen.findByTestId("monetization-save-ok")).toHaveTextContent(/Premium cut priced/i);
  });

  it("degrades to a graceful empty state when the revenue route is undeployed", async () => {
    const user = userEvent.setup();
    providers(<MonetizationSection />, makeFetch({ revenue: "404" }));
    await pickSeries(user);
    expect(await screen.findByTestId("monetization-revenue-not-available")).toBeInTheDocument();
  });
});

describe("Section 11 - Modify content", () => {
  it("confirms a destructive unpublish in a dialog that states versioning is preserved", async () => {
    const user = userEvent.setup();
    providers(<ModifyContentSection seriesId={SID} onSelectSeries={() => {}} />, makeFetch());
    await user.click(await screen.findByTestId("content-unpublish"));
    const dialog = await screen.findByTestId("content-confirm-dialog");
    expect(within(dialog).getByTestId("content-confirm-provenance")).toHaveTextContent(/provenance are preserved/i);
    await user.click(screen.getByTestId("content-confirm-go"));
    expect(await screen.findByTestId("content-result")).toHaveTextContent(/Unpublished/i);
  });

  it("treats an unwired action as a coming-soon seam and changes nothing", async () => {
    const user = userEvent.setup();
    providers(<ModifyContentSection seriesId={SID} onSelectSeries={() => {}} />, makeFetch());
    await user.click(await screen.findByTestId("content-replace-video"));
    await user.click(await screen.findByTestId("content-confirm-go"));
    expect(await screen.findByTestId("content-result")).toHaveTextContent(/coming soon/i);
  });

  it("deletes a premium variant via the content endpoint after confirmation", async () => {
    const user = userEvent.setup();
    providers(<ModifyContentSection seriesId={SID} onSelectSeries={() => {}} />, makeFetch());
    await user.click(await screen.findByTestId("content-delete-variant-var-premium-1"));
    await user.click(await screen.findByTestId("content-confirm-go"));
    expect(await screen.findByTestId("content-result")).toHaveTextContent(/Deleted variant/i);
  });
});
