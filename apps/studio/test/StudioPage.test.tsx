// Integration tests: render the whole StudioPage over the fake content server and walk the director DoD
// flow (create series, episode, beat, variant, draw edge) plus the graph read path. Verifies F1 at the
// UI boundary too. No em dashes.
import { describe, it, expect } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContentClient } from "../src/api/client.js";
import { ContentClientContext } from "../src/api/useContentClient.js";
import { StudioPage } from "../src/components/StudioPage.js";
import { createFakeContentServer, type FakeServer } from "./fakeContentServer.js";

function renderStudio(server: FakeServer) {
  const client = new ContentClient({ baseUrl: "http://content.test", fetchImpl: server.fetch });
  render(
    <ContentClientContext.Provider value={client}>
      <StudioPage />
    </ContentClientContext.Provider>,
  );
}

describe("StudioPage director workflow", () => {
  it("creates a series, episode, beat, variant, and draws an edge, with the graph reflecting each step", async () => {
    const server = createFakeContentServer();
    const user = userEvent.setup();
    renderStudio(server);

    // 1. Create a series. The page adopts the new id and loads its graph.
    await user.type(within(screen.getByTestId("form-series")).getByLabelText("Title"), "Adaptive Pilot");
    await user.click(within(screen.getByTestId("form-series")).getByRole("button", { name: "Create series" }));
    await screen.findByTestId("form-series-ok");
    await waitFor(() => expect(screen.getByTestId("graph-viewer")).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "Adaptive Pilot" })).toBeInTheDocument();
    expect(screen.getByTestId("no-episodes")).toBeInTheDocument();

    // 2. Create an episode under it.
    const epForm = screen.getByTestId("form-episode");
    await user.clear(within(epForm).getByLabelText("Episode number"));
    await user.type(within(epForm).getByLabelText("Episode number"), "1");
    await user.type(within(epForm).getByLabelText("Title"), "Cold Open");
    await user.click(within(epForm).getByRole("button", { name: "Create episode" }));
    await screen.findByTestId("form-episode-ok");
    await waitFor(() => expect(screen.getByTestId("episode-list")).toBeInTheDocument());

    // 3. Create a beat in that episode (the episode picker is populated from the loaded graph).
    const beatForm = screen.getByTestId("form-beat");
    await waitFor(() =>
      expect(within(beatForm).getByRole("option", { name: /Episode 1: Cold Open/ })).toBeInTheDocument(),
    );
    await user.selectOptions(
      within(beatForm).getByLabelText("Episode"),
      within(beatForm).getByRole("option", { name: /Episode 1: Cold Open/ }),
    );
    await user.click(within(beatForm).getByRole("button", { name: "Create beat" }));
    await screen.findByTestId("form-beat-ok");
    await waitFor(() => expect(screen.getByText(/Beat #0 \[spine\]/)).toBeInTheDocument());

    // 4. Attach a variant to that beat.
    const variantForm = screen.getByTestId("form-variant");
    await waitFor(() =>
      expect(within(variantForm).getByRole("option", { name: /beat #0/ })).toBeInTheDocument(),
    );
    await user.selectOptions(
      within(variantForm).getByLabelText("Beat"),
      within(variantForm).getByRole("option", { name: /beat #0/ }),
    );
    await user.type(within(variantForm).getByLabelText("Playback URL"), "https://cdn/ep1-b0-en.m3u8");
    await user.click(within(variantForm).getByRole("button", { name: "Attach variant" }));
    await screen.findByTestId("form-variant-ok");
    await waitFor(() => expect(screen.getByText(/en \/ A_filmed \/ intensity 3/)).toBeInTheDocument());

    // 5. Create a second beat, then draw an edge between the two.
    await user.selectOptions(
      within(beatForm).getByLabelText("Episode"),
      within(beatForm).getByRole("option", { name: /Episode 1: Cold Open/ }),
    );
    await user.clear(within(beatForm).getByLabelText("Beat index"));
    await user.type(within(beatForm).getByLabelText("Beat index"), "1");
    await user.click(within(beatForm).getByRole("button", { name: "Create beat" }));
    await screen.findByTestId("form-beat-ok");
    await waitFor(() => expect(screen.getByText(/Beat #1 \[spine\]/)).toBeInTheDocument());

    const edgeForm = screen.getByTestId("form-edge");
    await waitFor(() => {
      const opts = within(edgeForm).getAllByRole("option", { name: /beat #/ });
      expect(opts.length).toBeGreaterThanOrEqual(2);
    });
    const fromBeat = within(edgeForm).getByLabelText("From beat") as HTMLSelectElement;
    const toBeat = within(edgeForm).getByLabelText("To beat") as HTMLSelectElement;
    // Options are duplicated across both selects, so scope the option lookup to each select element.
    const beat0Option = within(fromBeat).getByRole("option", { name: /beat #0/ });
    const beat1Option = within(toBeat).getByRole("option", { name: /beat #1/ });
    await user.selectOptions(fromBeat, beat0Option);
    await user.selectOptions(toBeat, beat1Option);
    await user.click(within(edgeForm).getByRole("button", { name: "Draw edge" }));
    await screen.findByTestId("form-edge-ok");
    await waitFor(() => expect(screen.getByTestId("edge-list")).toBeInTheDocument());

    // F1 at the UI boundary: nothing the studio sent carried a user_id.
    for (const rec of server.lastBodies) {
      expect(rec.body).not.toHaveProperty("user_id");
    }
  });

  it("shows a 404 error when loading an unknown series id", async () => {
    const server = createFakeContentServer();
    const user = userEvent.setup();
    renderStudio(server);
    await user.type(screen.getByTestId("series-id-input"), "00000000-0000-4000-8000-0000000000aa");
    await user.click(screen.getByTestId("load-series"));
    const alert = await screen.findByTestId("graph-error");
    expect(alert).toHaveTextContent("series_not_found");
  });

  it("surfaces a server validation error in the form status (server-authoritative)", async () => {
    const server = createFakeContentServer();
    const user = userEvent.setup();
    renderStudio(server);
    // Empty title triggers the server's invalid_title. The required attribute is bypassed by submitting
    // the form programmatically via the button after clearing, so we rely on the server check; to surface
    // it we type a space then the server trims to empty.
    const seriesForm = screen.getByTestId("form-series");
    await user.type(within(seriesForm).getByLabelText("Title"), "   ");
    await user.click(within(seriesForm).getByRole("button", { name: "Create series" }));
    expect(await screen.findByTestId("form-series-error")).toHaveTextContent("invalid_title");
  });
});
