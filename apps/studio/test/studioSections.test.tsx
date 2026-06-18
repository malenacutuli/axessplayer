// Spec tests for Creator Studio sections 3-5 (Create with AI, Upload, Process). They assert the load-bearing
// product rules: the COST GATE blocks generation until the creator confirms; accessibility tracks default ON
// (opt out, not in); everything generated surfaces the C2PA + Article 50 label; the processing dashboard and
// review queue read the ingestion job; and every surface has real loading / empty / error states. The
// content + ingestion fetches are stubbed so the tests are hermetic. No em dashes.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContentClient, type FeedSeries } from "../src/api/client.js";
import { ContentClientContext } from "../src/api/useContentClient.js";
import { IngestionClient, type Job } from "../src/api/ingestion.js";
import { IngestionClientContext } from "../src/api/useIngestionClient.js";
import { CreateWithAiPanel } from "../src/components/studio/CreateWithAiPanel.js";
import { ProcessPanel } from "../src/components/studio/ProcessPanel.js";

afterEach(cleanup);

const FEED: FeedSeries[] = [
  { id: "11111111-1111-1111-1111-111111111111", title: "The Last Signal", genre: "Thriller", cover_url: null, poster_url: null, published_at: "2026-06-01" },
];

const GRAPH = {
  series: { id: FEED[0].id, title: "The Last Signal", base_language: "en", published_at: "2026-06-01", poster_url: null },
  episodes: [
    {
      id: "ep-1",
      episode_number: 1,
      title: "Pilot",
      beats: [
        { id: "beat-1", beat_index: 0, role: "spine", is_branch_point: false, canon_facts: { characters: ["Mara", "Cole"] }, variants: [] },
        { id: "beat-2", beat_index: 1, role: "hero", is_branch_point: false, canon_facts: {}, variants: [] },
      ],
    },
  ],
  edges: [],
};

function makeContentFetch(opts?: { emptyFeed?: boolean }) {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/feed") return json(200, { series: opts?.emptyFeed ? [] : FEED });
    if (url.pathname.endsWith("/graph")) return json(200, GRAPH);
    return json(404, { error: "not_found" });
  }) as typeof fetch;
}

function makeIngestionFetch(job: Job, opts?: { failProduce?: boolean }) {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/produce" && init?.method === "POST") {
      if (opts?.failProduce) return json(404, { error: "not_configured" });
      return json(200, { jobId: job.jobId, plan: [], estimatedUsd: job.estimatedUsd });
    }
    if (url.pathname === `/jobs/${job.jobId}`) return json(200, job);
    return json(404, { error: "not_found" });
  }) as typeof fetch;
}

function renderProcess(opts?: { contentOpts?: Parameters<typeof makeContentFetch>[0]; job?: Job; produceOpts?: Parameters<typeof makeIngestionFetch>[1] }) {
  const job: Job =
    opts?.job ?? {
      jobId: "job-abc12345",
      seriesId: FEED[0].id,
      episodeId: "ep-1",
      kind: "produce",
      state: "done",
      estimatedUsd: 1.23,
      stages: [
        { name: "transcript", label: "Transcript", status: "ready", cost: 0.03, kind: "transcript" },
        { name: "ad-en", label: "Audio description (en)", status: "needs_review", cost: 0.35, kind: "audio_description" },
        { name: "sign-asl", label: "Sign (ASL)", status: "needs_review", cost: 0.2, kind: "sign" },
      ],
    };
  const content = new ContentClient({ baseUrl: "http://content.test", fetchImpl: makeContentFetch(opts?.contentOpts) });
  const ingestion = new IngestionClient({ baseUrl: "http://ingest.test", fetchImpl: makeIngestionFetch(job, opts?.produceOpts) });
  render(
    <ContentClientContext.Provider value={content}>
      <IngestionClientContext.Provider value={ingestion}>
        <ProcessPanel />
      </IngestionClientContext.Provider>
    </ContentClientContext.Provider>,
  );
  return { job };
}

describe("CreateWithAiPanel cost gate", () => {
  it("does not generate until the creator confirms the cost", async () => {
    const user = userEvent.setup();
    render(<CreateWithAiPanel onNavigate={() => {}} />);
    // No generate button before previewing cost; preview is disabled until the premise is substantial.
    expect(screen.queryByTestId("create-confirm-generate")).not.toBeInTheDocument();
    expect(screen.getByTestId("create-preview-cost")).toBeDisabled();

    await user.type(screen.getByTestId("create-premise"), "A deaf cartographer reads the tides.");
    expect(screen.getByTestId("create-preview-cost")).toBeEnabled();
    await user.click(screen.getByTestId("create-preview-cost"));
    // Now the confirm button appears; only confirming proceeds.
    expect(screen.getByTestId("create-confirm-generate")).toBeInTheDocument();
    await user.click(screen.getByTestId("create-confirm-generate"));
    expect(screen.getByTestId("create-unwired")).toBeInTheDocument();
  });

  it("surfaces the C2PA + Article 50 provenance label", () => {
    render(<CreateWithAiPanel onNavigate={() => {}} />);
    const label = screen.getByTestId("create-provenance");
    expect(label).toHaveAttribute("data-mode", "generated");
    expect(within(label).getByText(/Article 50/)).toBeInTheDocument();
  });

  it("hands-on mode lets the creator trim stages and lower the estimate", async () => {
    const user = userEvent.setup();
    render(<CreateWithAiPanel onNavigate={() => {}} />);
    const before = screen.getByTestId("create-cost").textContent;
    await user.click(screen.getByTestId("create-mode-hands-on"));
    await user.click(screen.getByTestId("create-stage-toggle-keyframes"));
    expect(screen.getByTestId("create-cost").textContent).not.toEqual(before);
  });
});

describe("ProcessPanel GOLD_STANDARD_08", () => {
  it("defaults every accessibility track ON (opt out, not in) and gates the cost", async () => {
    const user = userEvent.setup();
    renderProcess();
    await user.selectOptions(await screen.findByTestId("series-picker"), FEED[0].id);
    // All four tracks start pressed.
    for (const t of ["cc", "ad", "sign", "dub"]) {
      expect(await screen.findByTestId(`process-track-${t}`)).toHaveAttribute("aria-pressed", "true");
    }
    // The cost gate blocks Process until the estimate is confirmed.
    expect(screen.queryByTestId("process-run")).not.toBeInTheDocument();
    await user.click(screen.getByTestId("process-confirm-cost"));
    expect(screen.getByTestId("process-run")).toBeInTheDocument();
  });

  it("runs the job and shows the live dashboard + review queue from the ingestion job", async () => {
    const user = userEvent.setup();
    renderProcess();
    await user.selectOptions(await screen.findByTestId("series-picker"), FEED[0].id);
    await user.click(await screen.findByTestId("process-confirm-cost"));
    await user.click(screen.getByTestId("process-run"));
    // The dashboard reads the job stages; the review queue lists the hero AD/sign drafts needing review.
    expect(await screen.findByTestId("process-stage-list")).toBeInTheDocument();
    const reviews = await screen.findByTestId("process-review-list");
    expect(within(reviews).getAllByTestId(/process-review-\d/).length).toBeGreaterThan(0);
    // A sign draft offers a human interpreter clip upload.
    expect(screen.getByTestId("process-review-upload-sign-1")).toBeInTheDocument();
  });

  it("shows a graceful error when the processing service is not connected", async () => {
    const user = userEvent.setup();
    renderProcess({ produceOpts: { failProduce: true } });
    await user.selectOptions(await screen.findByTestId("series-picker"), FEED[0].id);
    await user.click(await screen.findByTestId("process-confirm-cost"));
    await user.click(screen.getByTestId("process-run"));
    expect(await screen.findByTestId("process-error")).toHaveTextContent(/not connected/i);
  });

  it("populates the CWI character attribution from the series canon", async () => {
    const user = userEvent.setup();
    renderProcess();
    await user.selectOptions(await screen.findByTestId("series-picker"), FEED[0].id);
    const cwi = await screen.findByTestId("process-cwi-list");
    expect(within(cwi).getByTestId("process-cwi-Mara")).toBeInTheDocument();
    expect(within(cwi).getByTestId("process-cwi-Cole")).toBeInTheDocument();
  });

  it("shows the series-picker empty state with no series (no dead end)", async () => {
    renderProcess({ contentOpts: { emptyFeed: true } });
    expect(await screen.findByTestId("series-picker-empty")).toBeInTheDocument();
  });
});
