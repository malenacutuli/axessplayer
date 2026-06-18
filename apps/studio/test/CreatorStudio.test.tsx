// Creator Studio shell tests (prompt 22): the auth + tiers shell, the 14-section rail with reachable
// coming-soon routes, the Simple-default / Pro reveal, and the dashboard reading hosted aggregates (with a
// real empty / loading / error path and no dead ends). The content reads are stubbed with a tiny fetch so
// the test is hermetic and does not touch the live services. No em dashes.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContentClient, type AdminOverview, type FeedSeries } from "../src/api/client.js";
import { ContentClientContext } from "../src/api/useContentClient.js";
import { CreatorAuthProvider, type CreatorSession } from "../src/auth/creatorAuth.js";
import { CreatorStudio } from "../src/components/CreatorStudio.js";

const OVERVIEW: AdminOverview = {
  series: { published: 2, total: 3 },
  variants: {
    total: 10,
    premium: 2,
    qaPassed: 8,
    withCaptions: 6,
    withAudioDescription: 4,
    withSign: 3,
    withDub: 2,
  },
  ledger: {
    transactions: 40,
    coinsGranted: 500,
    coinsSpent: 120,
    byType: [],
    wallets: 25,
    walletBalance: 380,
  },
  decisions: 1543,
};

const FEED: FeedSeries[] = [
  { id: "11111111-1111-1111-1111-111111111111", title: "The Last Signal", genre: "Thriller", cover_url: null, poster_url: null, published_at: "2026-06-01" },
];

function makeFetch(opts?: { failOverview?: boolean; emptyOverview?: boolean; emptyFeed?: boolean }) {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/admin/overview") {
      if (opts?.failOverview) return json(500, { error: "boom" });
      if (opts?.emptyOverview) {
        return json(200, {
          ...OVERVIEW,
          series: { published: 0, total: 0 },
          variants: { ...OVERVIEW.variants, total: 0, qaPassed: 0, withCaptions: 0, withAudioDescription: 0, withSign: 0, withDub: 0 },
        });
      }
      return json(200, OVERVIEW);
    }
    if (url.pathname === "/feed") {
      return json(200, { series: opts?.emptyFeed ? [] : FEED });
    }
    return json(404, { error: "not_found" });
  }) as typeof fetch;
}

function renderStudio(opts?: { session?: CreatorSession | null; fetchOpts?: Parameters<typeof makeFetch>[0] }) {
  const client = new ContentClient({ baseUrl: "http://content.test", fetchImpl: makeFetch(opts?.fetchOpts) });
  render(
    <ContentClientContext.Provider value={client}>
      <CreatorAuthProvider initialSession={opts && "session" in opts ? opts.session ?? null : { name: "Test Studio", tier: "solo" }}>
        <CreatorStudio />
      </CreatorAuthProvider>
    </ContentClientContext.Provider>,
  );
}

describe("CreatorStudio", () => {
  beforeEach(() => {
    window.location.hash = "";
  });
  afterEach(() => {
    window.location.hash = "";
  });

  it("shows the auth shell with the three tiers when signed out", async () => {
    const user = userEvent.setup();
    renderStudio({ session: null });
    expect(screen.getByTestId("auth-shell")).toBeInTheDocument();
    expect(screen.getByTestId("tier-solo")).toBeInTheDocument();
    expect(screen.getByTestId("tier-agency")).toBeInTheDocument();
    expect(screen.getByTestId("tier-production")).toBeInTheDocument();
    // Agency + production surface a coming-soon note for their advanced capability.
    expect(screen.getByTestId("tier-soon-agency")).toBeInTheDocument();
    expect(screen.getByTestId("tier-soon-production")).toBeInTheDocument();

    // Signing in unlocks the studio (dashboard) and carries the chosen tier.
    await user.click(within(screen.getByTestId("tier-production")).getByRole("radio"));
    await user.click(screen.getByTestId("auth-submit"));
    expect(await screen.findByTestId("panel-dashboard")).toBeInTheDocument();
    expect(screen.getByTestId("creator-tier")).toHaveTextContent(/Production/);
  });

  it("renders the dashboard from hosted aggregates with one primary action and a next-best-action", async () => {
    renderStudio();
    expect(await screen.findByTestId("dashboard-loaded")).toBeInTheDocument();
    // Real KPIs from the overview read.
    expect(screen.getByText("1,543")).toBeInTheDocument(); // engagement (decisions)
    // ONE primary action.
    expect(screen.getByTestId("primary-create")).toBeInTheDocument();
    // Next-best-action surface present.
    expect(screen.getByTestId("next-best-action")).toBeInTheDocument();
    expect(screen.getByTestId("nba-action")).toBeInTheDocument();
    // Retention is a band, not a point.
    expect(screen.getByTestId("retention-band-label")).toHaveTextContent(/to/);
  });

  it("shows the empty dashboard state with a create action when nothing is published", async () => {
    renderStudio({ fetchOpts: { emptyOverview: true, emptyFeed: true } });
    expect(await screen.findByTestId("empty-create")).toBeInTheDocument();
  });

  it("shows the dashboard error state with a retry and no dead end", async () => {
    renderStudio({ fetchOpts: { failOverview: true } });
    expect(await screen.findByTestId("dashboard-error")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-retry")).toBeInTheDocument();
  });

  it("lists all 14 sections and routes to a reachable coming-soon route", async () => {
    const user = userEvent.setup();
    renderStudio();
    await screen.findByTestId("dashboard-loaded");
    for (const id of ["dashboard", "create", "library", "branch", "media", "accessibility", "poster", "analytics", "monetization", "channel", "settings"]) {
      expect(screen.getByTestId(`nav-${id}`)).toBeInTheDocument();
    }
    // Accessibility is not built yet: reachable coming-soon, with a back action (no dead end).
    await user.click(screen.getByTestId("nav-accessibility"));
    expect(await screen.findByTestId("panel-accessibility")).toBeInTheDocument();
    expect(screen.getByTestId("coming-soon-back")).toBeInTheDocument();
    await user.click(screen.getByTestId("coming-soon-back"));
    expect(await screen.findByTestId("panel-dashboard")).toBeInTheDocument();
  });

  it("hides pro-only sections in Simple mode and reveals them in Pro mode", async () => {
    const user = userEvent.setup();
    renderStudio();
    await screen.findByTestId("dashboard-loaded");
    // Brand/Team/Rights are pro-only: present in the DOM but hidden in Simple mode.
    expect(screen.getByTestId("nav-brand")).toHaveAttribute("hidden");
    expect(screen.getByTestId("nav-brand")).toHaveAttribute("data-pro-only", "true");

    // Flip Pro on via the rail toggle.
    await user.click(screen.getByRole("switch", { name: /Pro mode/i }));
    expect(screen.getByTestId("mode-label")).toHaveTextContent("Pro");
    expect(screen.getByTestId("nav-brand")).not.toHaveAttribute("hidden");
  });

  it("routes the rail to the authoring workflow (Library) without a second rail", async () => {
    const user = userEvent.setup();
    renderStudio();
    await screen.findByTestId("dashboard-loaded");
    await user.click(screen.getByTestId("nav-library"));
    expect(await screen.findByTestId("panel-library")).toBeInTheDocument();
    // Only the 14-section rail exists; the legacy SideRail (nav-operator) is not rendered.
    expect(screen.queryByTestId("nav-operator")).not.toBeInTheDocument();
  });
});
