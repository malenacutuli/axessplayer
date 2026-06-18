// Spec tests for SECTION 8 (Branch and endings). The load-bearing product rules: a series picker reads the
// real feed; the graph loads from the catalog; Simple mode shows a linear timeline and Pro reveals the SVG
// graph + an accessible roving node list; broken links and canon errors are shown INLINE and BLOCK
// publishing; premium cuts (alt-ending / POV / intensity) are merchandised with a creator-set coin price and
// an upload + unwired AI-generate entry; memory variables are shown; and an undeployed catalog renders a
// graceful empty state (no dead end). The fetches are stubbed so the tests are hermetic. No em dashes.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContentClient, type FeedSeries } from "../src/api/client.js";
import { ContentClientContext } from "../src/api/useContentClient.js";
import { CatalogClient } from "../src/api/catalogClient.js";
import { CatalogClientContext } from "../src/api/useCatalogClient.js";
import { BranchesSection } from "../src/components/studio/BranchesSection.js";
import type { SeriesGraphView } from "../src/api/catalogTypes.js";

afterEach(cleanup);

const SID = "11111111-1111-1111-1111-111111111111";
const FEED: FeedSeries[] = [
  { id: SID, title: "The Last Signal", genre: "Thriller", cover_url: null, poster_url: null, published_at: "2026-06-01" },
];

const VALID_GRAPH: SeriesGraphView = {
  seriesId: SID,
  seriesTitle: "The Last Signal",
  nodes: [
    { id: "a", kind: "beat", title: "Cold open", reads: [], writes: ["sawSignal"] },
    { id: "b", kind: "branch", title: "The fork", reads: ["sawSignal"], writes: [] },
    { id: "c", kind: "ending", title: "Reunion" },
    { id: "p", kind: "premium", title: "Alt ending", pricing: { priceCoins: 8, source: "uploaded" } },
  ],
  edges: [
    { from: "a", to: "b", isDefault: true },
    { from: "b", to: "c", isDefault: true },
    { from: "b", to: "p", choice: "pay" },
  ],
  memoryVars: [{ name: "sawSignal", type: "boolean", note: "Did the viewer notice the signal" }],
  canon: { valid: true, issues: [] },
  pricing: { currency: "coins", premiumFloor: 5 },
};

const BROKEN_GRAPH: SeriesGraphView = {
  ...VALID_GRAPH,
  edges: [...VALID_GRAPH.edges, { from: "c", to: "ghost" }],
  canon: { valid: false, issues: [{ severity: "error", message: "Mara cannot appear after her death" }] },
};

function makeFetch(graph: SeriesGraphView | "404", opts?: { emptyFeed?: boolean }) {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/feed") return json(200, { series: opts?.emptyFeed ? [] : FEED });
    if (url.pathname.endsWith("/graph")) {
      if (graph === "404") return json(404, { error: "not_found" });
      return json(200, graph);
    }
    return json(404, { error: "not_found" });
  }) as typeof fetch;
}

function renderBranches(opts: { graph: SeriesGraphView | "404"; proMode?: boolean; emptyFeed?: boolean }) {
  const fetchImpl = makeFetch(opts.graph, { emptyFeed: opts.emptyFeed });
  const content = new ContentClient({ baseUrl: "http://content.test", fetchImpl });
  const catalog = new CatalogClient({ baseUrl: "http://catalog.test", token: "session:test", fetchImpl });
  render(
    <ContentClientContext.Provider value={content}>
      <CatalogClientContext.Provider value={catalog}>
        <BranchesSection proMode={opts.proMode ?? false} />
      </CatalogClientContext.Provider>
    </ContentClientContext.Provider>,
  );
}

async function selectSeries(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(await screen.findByTestId("series-picker"), SID);
}

describe("BranchesSection section 8", () => {
  it("shows the simple-mode linear timeline by default and the memory variables", async () => {
    const user = userEvent.setup();
    renderBranches({ graph: VALID_GRAPH });
    await selectSeries(user);
    expect(await screen.findByTestId("branches-timeline")).toBeInTheDocument();
    // Default-path spine nodes appear as timeline steps; the premium alt ending is an offshoot.
    expect(screen.getByTestId("tl-node-a")).toBeInTheDocument();
    expect(screen.getByTestId("tl-offshoot-p")).toBeInTheDocument();
    // Memory variable is shown.
    expect(screen.getByTestId("branches-memvar-sawSignal")).toBeInTheDocument();
    // A valid graph announces it is valid.
    expect(screen.getByTestId("branches-valid")).toBeInTheDocument();
  });

  it("reveals the SVG graph and an accessible roving node list in Pro mode", async () => {
    const user = userEvent.setup();
    renderBranches({ graph: VALID_GRAPH, proMode: true });
    await selectSeries(user);
    expect(await screen.findByTestId("branches-pro")).toHaveAttribute("data-pro-only", "true");
    expect(screen.getByTestId("branches-svg")).toBeInTheDocument();
    const list = screen.getByTestId("branches-nodelist");
    expect(list).toHaveAttribute("role", "listbox");
    // Arrow-down moves the roving selection and updates aria-activedescendant.
    list.focus();
    await user.keyboard("{ArrowDown}");
    expect(list.getAttribute("aria-activedescendant")).toBeTruthy();
  });

  it("blocks publishing on a broken link plus a canon error, shown inline", async () => {
    const user = userEvent.setup();
    renderBranches({ graph: BROKEN_GRAPH });
    await selectSeries(user);
    expect(await screen.findByTestId("branches-blockers")).toBeInTheDocument();
    expect(screen.getByTestId("broken-links")).toBeInTheDocument();
    expect(screen.getByTestId("branches-publish")).toBeDisabled();
    expect(screen.getByTestId("branches-publish-blocked")).toBeInTheDocument();
  });

  it("merchandises a selected premium cut with a creator-set price, upload, and unwired AI-generate", async () => {
    const user = userEvent.setup();
    renderBranches({ graph: VALID_GRAPH });
    await selectSeries(user);
    // Select the premium alt-ending offshoot.
    await user.click(await screen.findByTestId("tl-offshoot-p"));
    const price = await screen.findByTestId("branches-merch-price");
    expect(price).toHaveValue(8);
    expect(screen.getByTestId("branches-merch-upload")).toBeInTheDocument();
    // AI-generate is the unwired / coming-soon state.
    expect(screen.getByTestId("branches-merch-ai")).toBeDisabled();
    // Coins are the only rail (no live card payment).
    expect(screen.getByTestId("branches-merch-rail")).toBeInTheDocument();
  });

  it("renders a graceful empty state when the catalog graph route is not deployed (no dead end)", async () => {
    const user = userEvent.setup();
    renderBranches({ graph: "404" });
    await selectSeries(user);
    expect(await screen.findByTestId("branches-not-available")).toBeInTheDocument();
    expect(screen.getByTestId("branches-retry")).toBeInTheDocument();
  });

  it("shows the picker empty state with no series", async () => {
    renderBranches({ graph: VALID_GRAPH, emptyFeed: true });
    expect(await screen.findByTestId("series-picker-empty")).toBeInTheDocument();
  });
});
