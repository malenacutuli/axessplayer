// Integration tests: render the whole StudioPage over the fake content server seeded with the real "The
// Last Signal" fixture, and walk the studio panels (Library, Branch editor, Media & variants, Pricing,
// Publish). Verifies the live wiring (the branch editor renders nodes/edges from the real graph; uploading
// a variant POSTs to /variants and the canvas refreshes) and F1 at the UI boundary. No em dashes.
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContentClient } from "../src/api/client.js";
import { ContentClientContext } from "../src/api/useContentClient.js";
import { StudioPage } from "../src/components/StudioPage.js";
import { createFakeContentServer, type FakeServer } from "./fakeContentServer.js";

// The Media panel uploads + HLS-encodes the staged master via the media server. Mock that network call so
// the test stays hermetic; the mock walks the lifecycle (uploading -> encoding) and returns a master.m3u8
// exactly as the real media server would after a successful encode.
vi.mock("../src/api/media.js", () => ({
  uploadAndEncode: vi.fn(async (file: File, opts?: { onState?: (s: "uploading" | "encoding") => void }) => {
    opts?.onState?.("uploading");
    opts?.onState?.("encoding");
    return { url: `http://127.0.0.1:8095/media/${file.name.replace(/\s+/g, "-")}/master.m3u8`, jobId: "job-1" };
  }),
  isPlayableVideoUrl: (u: string | undefined) =>
    !!u && (/\.(m3u8|mp4|m4v|mov|webm|ogv|ogg)(\?|$)/i.test(u) || u.includes("/media/")),
  pingMediaServer: vi.fn(async () => true),
  attachHls: vi.fn(async () => () => {}),
  deleteMedia: vi.fn(async () => true),
  mediaIdFromUrl: (u: string | undefined) => {
    const m = u?.match(/\/media\/([^/]+)\//);
    return m ? m[1] : null;
  },
  mediaBaseUrl: () => "http://127.0.0.1:8095",
}));

function renderStudio(server: FakeServer) {
  const client = new ContentClient({ baseUrl: "http://content.test", fetchImpl: server.fetch });
  render(
    <ContentClientContext.Provider value={client}>
      <StudioPage />
    </ContentClientContext.Provider>,
  );
}

describe("StudioPage", () => {
  let server: FakeServer;
  beforeEach(() => {
    server = createFakeContentServer();
    server.seedLastSignal();
  });

  it("shows the Library with the live series and publish badges", async () => {
    renderStudio(server);
    expect(screen.getByTestId("panel-library")).toBeInTheDocument();
    expect(screen.getByText("The Last Signal")).toBeInTheDocument();
    // LIVE / DRAFT / OUTLINE badges from the prototype.
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getAllByText("DRAFT").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("OUTLINE")).toBeInTheDocument();
    // Let the background graph load settle so the StudioPage state update is flushed under act().
    await waitFor(() => expect(screen.getByTestId("panel-library")).toBeInTheDocument());
  });

  it("opens the branch editor from the library and renders nodes and edges from the real graph", async () => {
    const user = userEvent.setup();
    renderStudio(server);

    await user.click(screen.getByTestId("library-card-live"));
    await waitFor(() => expect(screen.getByTestId("panel-branch")).toBeInTheDocument());

    // Five seeded beats become five nodes; the premium ending makes the ending beat a gold premium node.
    const seed = ["bbbbbbbb-0000-0000-0000-000000000001", "bbbbbbbb-0000-0000-0000-000000000002", "bbbbbbbb-0000-0000-0000-000000000004"];
    for (const id of seed) {
      expect(screen.getByTestId(`gnode-${id}`)).toBeInTheDocument();
    }
    // Edge kinds: a rose fork out of the branch point, a gold dashed premium edge into the premium ending.
    expect(screen.getAllByTestId("edge-fork").length).toBeGreaterThanOrEqual(1);
    // Premium node shows coins in gold.
    expect(screen.getByText(/5 coins/)).toBeInTheDocument();
  });

  it("selects a node (rose ring) and carries the selection to Media", async () => {
    const user = userEvent.setup();
    renderStudio(server);
    await user.click(screen.getByTestId("library-card-live"));
    await waitFor(() => expect(screen.getByTestId("panel-branch")).toBeInTheDocument());

    const branchNode = await screen.findByTestId("gnode-bbbbbbbb-0000-0000-0000-000000000002");
    await user.click(branchNode);
    expect(branchNode).toHaveAttribute("data-selected", "true");

    await user.click(screen.getByTestId("goto-media"));
    expect(await screen.findByTestId("panel-media")).toBeInTheDocument();
    // The media panel shows the selected branch beat in its eyebrow.
    expect(screen.getByText(/branch point/i)).toBeInTheDocument();
  });

  it("uploads a variant (POST /variants) and the graph reflects it, with no user_id sent", async () => {
    const user = userEvent.setup();
    renderStudio(server);
    await user.click(screen.getByTestId("library-card-live"));
    await waitFor(() => expect(screen.getByTestId("panel-branch")).toBeInTheDocument());

    // Select the cold open beat, go to media, count its variants.
    await user.click(screen.getByTestId("gnode-bbbbbbbb-0000-0000-0000-000000000001"));
    await user.click(screen.getByTestId("goto-media"));
    const mediaPanel = await screen.findByTestId("panel-media");
    const before = within(mediaPanel).getByTestId("variant-list").querySelectorAll('[data-testid^="variant-row-"]').length;

    const form = within(mediaPanel).getByTestId("form-variant");
    await user.type(within(form).getByLabelText(/Playback URL/), "https://cdn/new-variant.m3u8");
    await user.click(within(form).getByRole("button", { name: "Upload variant" }));
    await screen.findByTestId("form-variant-ok");

    await waitFor(() => {
      const after = screen
        .getByTestId("variant-list")
        .querySelectorAll('[data-testid^="variant-row-"]').length;
      expect(after).toBe(before + 1);
    });

    // The POST hit /variants and carried the re-stamped beat_id, never a user_id.
    const lastVariantPost = server.lastBodies.filter((b) => b.path === "/variants").at(-1);
    expect(lastVariantPost?.body).toMatchObject({ beat_id: "bbbbbbbb-0000-0000-0000-000000000001" });
    for (const rec of server.lastBodies) {
      expect(rec.body).not.toHaveProperty("user_id");
    }
  });

  it("removes a variant (DELETE /variants/{id}) and the list shrinks by one", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    renderStudio(server);
    await user.click(screen.getByTestId("library-card-live"));
    await waitFor(() => expect(screen.getByTestId("panel-branch")).toBeInTheDocument());

    await user.click(screen.getByTestId("gnode-bbbbbbbb-0000-0000-0000-000000000001"));
    await user.click(screen.getByTestId("goto-media"));
    const mediaPanel = await screen.findByTestId("panel-media");
    const rows = within(mediaPanel)
      .getByTestId("variant-list")
      .querySelectorAll('[data-testid^="variant-row-"]');
    const before = rows.length;
    expect(before).toBeGreaterThan(0);
    // The first row's id is encoded in its remove button testid.
    const firstId = rows[0].getAttribute("data-testid")!.replace("variant-row-", "");

    await user.click(within(mediaPanel).getByTestId(`variant-remove-${firstId}`));

    await waitFor(() => {
      const after = screen
        .getByTestId("variant-list")
        .querySelectorAll('[data-testid^="variant-row-"]').length;
      expect(after).toBe(before - 1);
    });
    // The removed row is gone and no remove error surfaced.
    expect(screen.queryByTestId(`variant-row-${firstId}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId("variant-remove-error")).not.toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it("stages a chosen master in the drop zone and registers it with a derived URL", async () => {
    const user = userEvent.setup();
    renderStudio(server);
    await user.click(screen.getByTestId("library-card-live"));
    await waitFor(() => expect(screen.getByTestId("panel-branch")).toBeInTheDocument());
    await user.click(screen.getByTestId("gnode-bbbbbbbb-0000-0000-0000-000000000001"));
    await user.click(screen.getByTestId("goto-media"));
    const mediaPanel = await screen.findByTestId("panel-media");

    // The fix: the drop zone exposes a real file input and choosing a file stages it. Before, the drop
    // zone had no input and clicking it opened nothing.
    const input = within(mediaPanel).getByTestId("file-input");
    const file = new File([new Uint8Array(2048)], "Rooftop Master.mov", { type: "video/quicktime" });
    await user.upload(input, file);
    expect(within(mediaPanel).getByTestId("picked-name")).toHaveTextContent("Rooftop Master.mov");

    // Register with NO playback URL typed: the staged master is uploaded + HLS-encoded and the resulting
    // master.m3u8 is registered as the beat_variant playback_url, with qa_status passed (encode succeeded).
    await user.click(within(mediaPanel).getByRole("button", { name: "Upload and encode" }));
    await screen.findByTestId("form-variant-ok");
    const lastVariantPost = server.lastBodies.filter((b) => b.path === "/variants").at(-1);
    expect(lastVariantPost?.body).toMatchObject({
      beat_id: "bbbbbbbb-0000-0000-0000-000000000001",
      playback_url: "http://127.0.0.1:8095/media/Rooftop-Master.mov/master.m3u8",
      qa_status: "passed",
    });
    // The encoded variant is shown in the preview player.
    expect(await screen.findByTestId("preview-video")).toHaveAttribute(
      "data-src",
      "http://127.0.0.1:8095/media/Rooftop-Master.mov/master.m3u8",
    );
  });

  it("sets a premium price (POST /variants is_premium) from the Pricing panel", async () => {
    const user = userEvent.setup();
    renderStudio(server);
    await user.click(screen.getByTestId("library-card-live"));
    await waitFor(() => expect(screen.getByTestId("panel-branch")).toBeInTheDocument());
    await user.click(screen.getByTestId("goto-media"));
    await user.click(await screen.findByTestId("goto-pricing"));

    const pricing = await screen.findByTestId("panel-pricing");
    const priceInput = within(pricing).getByLabelText(/Premium alternate ending/);
    await user.clear(priceInput);
    await user.type(priceInput, "7");
    await user.click(within(pricing).getByRole("button", { name: "Set premium price" }));
    await screen.findByTestId("form-pricing-ok");

    const lastPost = server.lastBodies.filter((b) => b.path === "/variants").at(-1);
    expect(lastPost?.body).toMatchObject({ is_premium: true, coin_cost: 7 });
  });

  it("publishes the series for real (POST /series/{id}/publish) and reflects the live state", async () => {
    const user = userEvent.setup();
    renderStudio(server);
    await user.click(screen.getByTestId("library-card-live"));
    await waitFor(() => expect(screen.getByTestId("panel-branch")).toBeInTheDocument());
    await user.click(screen.getByTestId("goto-media"));
    await user.click(await screen.findByTestId("goto-pricing"));
    await user.click(await screen.findByTestId("goto-publish"));

    const publish = await screen.findByTestId("panel-publish");
    expect(within(publish).getByTestId("publish-checklist")).toBeInTheDocument();
    expect(within(publish).getByText(/Premium ending priced \(5 coins\)/)).toBeInTheDocument();

    // Publish: the button calls the real route; after the graph reloads the panel shows the live state and
    // the button flips to Unpublish.
    await user.click(within(publish).getByRole("button", { name: "Publish to feed" }));
    expect(await screen.findByTestId("publish-confirmation")).toHaveTextContent(/Live on the consumer feed/);
    expect(await screen.findByRole("button", { name: "Unpublish" })).toBeInTheDocument();
  });

  it("shows a load error when the series graph is missing", async () => {
    const empty = createFakeContentServer(); // not seeded: the live series id 404s
    const user = userEvent.setup();
    renderStudio(empty);
    await user.click(screen.getByTestId("library-card-live"));
    expect(await screen.findByTestId("graph-error")).toHaveTextContent("series_not_found");
  });
});
