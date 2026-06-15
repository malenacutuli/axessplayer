// Component test for the immersive adaptive player. It shows the opening cut with accessibility tracks
// on by default, advances through the graph over the SDK (decide -> prefetch -> seamless switch, using
// the variant -> beat resolver so the walk actually progresses), lets the viewer toggle a track in the
// a11y sheet, and feels the per-viewer re-cut via the branch picker. The media stack is integration
// time; here we drive the orchestration and the contract calls. No em dashes.

import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Player } from "./Player.js";
import { createMockServer } from "../test/mockServer.js";
import { createEconomyClient } from "../api/economy.js";
import { createWebTransport } from "./webTransport.js";
import { staticSession } from "../api/session.js";
import { seedGraph, BEAT_COLD_OPEN, VAR_COLD_OPEN } from "../test/fixtures.js";

const BASE = "http://mock";
const session = staticSession("test-token");

function setup(balance = 10) {
  const server = createMockServer({ balance });
  const economy = createEconomyClient({ baseUrl: BASE, session, fetch: server.fetch });
  const transport = createWebTransport({
    decisionBaseUrl: BASE,
    manifestBaseUrl: BASE,
    session,
    fetch: server.fetch,
  });
  return { server, economy, transport };
}

function renderPlayer(transport: ReturnType<typeof setup>["transport"], economy: ReturnType<typeof setup>["economy"]) {
  return render(
    <Player
      graph={seedGraph()}
      transport={transport}
      economy={economy}
      userId="u"
      startBeatId={BEAT_COLD_OPEN}
      onBack={() => {}}
    />,
  );
}

describe("Player", () => {
  beforeEach(() => {
    try {
      localStorage.removeItem("axessplayer.a11y");
    } catch {
      // ignore
    }
  });

  it("shows the opening cut and defaults accessibility tracks on", () => {
    const { economy, transport } = setup();
    renderPlayer(transport, economy);
    // The cold open variant carries captions, audio description, and sign.
    expect(screen.getByTestId("track-captions")).toBeInTheDocument();
    expect(screen.getByTestId("track-audio-description")).toBeInTheDocument();
    expect(screen.getByTestId("track-sign")).toBeInTheDocument();
    expect(screen.getByTestId("track-language")).toHaveTextContent("en");
  });

  it("renders the adaptive badge and the branch picker pills", () => {
    const { economy, transport } = setup();
    renderPlayer(transport, economy);
    expect(screen.getByTestId("adaptive-badge")).toHaveTextContent(/YOUR CUT/);
    expect(screen.getByTestId("branch-calm")).toBeInTheDocument();
    expect(screen.getByTestId("branch-tense")).toBeInTheDocument();
  });

  it("starts vertical and rotates to landscape on the rotate button", async () => {
    const user = userEvent.setup();
    const { economy, transport } = setup();
    renderPlayer(transport, economy);
    const player = screen.getByTestId("player");
    expect(player).toHaveAttribute("data-orientation", "portrait");
    await user.click(screen.getByTestId("player-rotate"));
    expect(player).toHaveAttribute("data-orientation", "landscape");
    expect(player.className).toContain("landscape");
    // Toggling back returns to vertical.
    await user.click(screen.getByTestId("player-rotate"));
    expect(player).toHaveAttribute("data-orientation", "portrait");
  });

  it("feels the per-viewer re-cut: picking Calm shows the calm beat line", async () => {
    const { economy, transport } = setup();
    renderPlayer(transport, economy);
    await userEvent.click(screen.getByTestId("branch-calm"));
    expect(screen.getByTestId("adaptive-badge")).toHaveTextContent(/CALM/);
    expect(screen.getByTestId("beat-line")).toHaveTextContent(/Rooftop/);
  });

  it("advances through the graph and switches to the next cut", async () => {
    const { economy, transport } = setup();
    renderPlayer(transport, economy);
    const surface = screen.getByTestId("player-surface");
    expect(surface).toHaveAttribute("data-variant-id", VAR_COLD_OPEN);

    await userEvent.click(screen.getByTestId("player-advance"));
    await waitFor(() => {
      expect(surface.getAttribute("data-variant-id")).not.toBe(VAR_COLD_OPEN);
    });
  });

  it("lets the viewer turn captions off in the a11y sheet", async () => {
    const { economy, transport } = setup();
    renderPlayer(transport, economy);
    expect(screen.getByTestId("track-captions")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("player-a11y-open"));
    await userEvent.click(screen.getByTestId("a11y-captions"));
    expect(screen.queryByTestId("track-captions")).not.toBeInTheDocument();
  });
});
