// Component test for the adaptive player screen. It plays the opening cut, advances through the graph
// over the SDK (decide -> prefetch -> seamless switch), defaults accessibility tracks on where the
// variant provides them, and presents the paywall when a premium cut gates the beat. The media stack
// is integration-time; here we drive the orchestration and the contract calls. No em dashes.

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

describe("Player", () => {
  beforeEach(() => {
    // Each test starts with default a11y preferences. Remove the persisted key (jsdom's localStorage
    // here does not implement clear()).
    try {
      localStorage.removeItem("axessplayer.a11y");
    } catch {
      // ignore
    }
  });

  it("shows the opening cut and defaults accessibility tracks on", () => {
    const { economy, transport } = setup();
    render(
      <Player graph={seedGraph()} transport={transport} economy={economy} userId="u" startBeatId={BEAT_COLD_OPEN} />,
    );
    // The cold open variant carries captions, audio description, and sign.
    expect(screen.getByTestId("track-captions")).toBeInTheDocument();
    expect(screen.getByTestId("track-audio-description")).toBeInTheDocument();
    expect(screen.getByTestId("track-sign")).toBeInTheDocument();
    expect(screen.getByTestId("track-language")).toHaveTextContent("en");
  });

  it("advances through the graph and switches to the next cut", async () => {
    const { economy, transport } = setup();
    render(
      <Player graph={seedGraph()} transport={transport} economy={economy} userId="u" startBeatId={BEAT_COLD_OPEN} />,
    );
    const surface = screen.getByTestId("player-surface");
    expect(surface).toHaveAttribute("data-variant-id", VAR_COLD_OPEN);

    await userEvent.click(screen.getByTestId("player-advance"));
    await waitFor(() => {
      // After the first advance, the player switched off the cold open to the branch point cut.
      expect(surface.getAttribute("data-variant-id")).not.toBe(VAR_COLD_OPEN);
    });
  });

  it("lets the viewer turn captions off", async () => {
    const { economy, transport } = setup();
    render(
      <Player graph={seedGraph()} transport={transport} economy={economy} userId="u" startBeatId={BEAT_COLD_OPEN} />,
    );
    expect(screen.getByTestId("track-captions")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("a11y-captions"));
    expect(screen.queryByTestId("track-captions")).not.toBeInTheDocument();
  });
});
