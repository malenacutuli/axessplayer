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

  it("offers ASL and PSL in the sign-language panel and switches the inset track", async () => {
    const user = userEvent.setup();
    const { economy, transport } = setup();
    renderPlayer(transport, economy);
    await user.click(screen.getByTestId("player-a11y-open"));
    // both produced sign languages are selectable
    expect(screen.getByTestId("a11y-sign-lang-ASL")).toBeInTheDocument();
    expect(screen.getByTestId("a11y-sign-lang-PSL")).toBeInTheDocument();
    // default is the ASL track
    expect(screen.getByTestId("sign-video")).toHaveAttribute("src", expect.stringContaining("asl_sign.webm"));
    // selecting PSL swaps the inset to the sibling PSL track
    await user.click(screen.getByTestId("a11y-sign-lang-PSL"));
    expect(screen.getByTestId("sign-video")).toHaveAttribute("src", expect.stringContaining("psl_sign.webm"));
  });

  it("renders the adaptive badge and the branch picker pills", () => {
    const { economy, transport } = setup();
    renderPlayer(transport, economy);
    expect(screen.getByTestId("adaptive-badge")).toHaveTextContent(/YOUR CUT/);
    expect(screen.getByTestId("branch-calm")).toBeInTheDocument();
    expect(screen.getByTestId("branch-tense")).toBeInTheDocument();
  });

  it("discloses why this cut (EU AI Act Article 50), human and machine readable", async () => {
    const user = userEvent.setup();
    const { economy, transport } = setup();
    renderPlayer(transport, economy);
    // The adaptive badge opens the disclosure.
    await user.click(screen.getByTestId("adaptive-badge"));
    const sheet = screen.getByTestId("why-this-cut");
    expect(sheet).toHaveTextContent(/re-cut itself for you/i);
    expect(sheet).toHaveTextContent(/EU AI Act/i);
    // Machine-readable disclosure carries the adaptation facts (generated_uniquely = false).
    const machine = JSON.parse(sheet.getAttribute("data-adaptation") ?? "{}");
    expect(machine).toMatchObject({ adapted: true, generated_uniquely: false });
    expect(machine.accessibility).toBeDefined();
  });

  it("closes the why-this-cut sheet on Got it and on Escape (no modal trap)", async () => {
    const user = userEvent.setup();
    const { economy, transport } = setup();
    renderPlayer(transport, economy);
    const sheet = screen.getByTestId("why-this-cut");
    // Opening adds the .up class (visible); Got it removes it (slid off-screen, click-through).
    await user.click(screen.getByTestId("adaptive-badge"));
    expect(sheet.className).toContain("up");
    await user.click(screen.getByTestId("why-close"));
    expect(sheet.className).not.toContain("up");
    expect(sheet).toHaveAttribute("aria-hidden", "true");
    // Escape is the always-available escape hatch.
    await user.click(screen.getByTestId("adaptive-badge"));
    expect(sheet.className).toContain("up");
    await user.keyboard("{Escape}");
    expect(sheet.className).not.toContain("up");
  });

  it("opening the a11y sheet closes the why-this-cut sheet (no stacked modals)", async () => {
    const user = userEvent.setup();
    const { economy, transport } = setup();
    renderPlayer(transport, economy);
    await user.click(screen.getByTestId("adaptive-badge"));
    expect(screen.getByTestId("why-this-cut").className).toContain("up");
    await user.click(screen.getByTestId("player-a11y-open"));
    // Why-this-cut is dismissed; only the a11y sheet remains.
    expect(screen.getByTestId("why-this-cut").className).not.toContain("up");
    expect(screen.getByTestId("a11y-sheet")).toBeInTheDocument();
  });

  it("emits beat-level capture events when personalizing (Phase 0)", async () => {
    const user = userEvent.setup();
    const { economy, transport } = setup();
    const events: Array<{ type: string; choice?: string }> = [];
    const capture = {
      emit: (e: { type: string; choice?: string }) => events.push(e),
      flush: async () => {},
      buffered: () => [],
    } as unknown as Parameters<typeof Player>[0]["capture"];
    render(
      <Player
        graph={seedGraph()}
        transport={transport}
        economy={economy}
        userId="u"
        startBeatId={BEAT_COLD_OPEN}
        onBack={() => {}}
        capture={capture}
        personalize
      />,
    );
    // The opening beat emits beat_started.
    expect(events.some((e) => e.type === "beat_started")).toBe(true);
    // Picking a cut emits choice_made.
    await user.click(screen.getByTestId("branch-tense"));
    expect(events.some((e) => e.type === "choice_made" && e.choice === "tense")).toBe(true);
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

  it("advances to the next beat on a wheel-down swipe gesture", async () => {
    const { economy, transport } = setup();
    renderPlayer(transport, economy);
    const surface = screen.getByTestId("player-surface");
    expect(surface).toHaveAttribute("data-variant-id", VAR_COLD_OPEN);
    expect(screen.getByTestId("swipe-hint")).toBeInTheDocument();

    // A large, deliberate wheel-down past the threshold pages to the next beat (a small nudge must not).
    const player = screen.getByTestId("player");
    player.dispatchEvent(new WheelEvent("wheel", { deltaY: 40, bubbles: true })); // small nudge: ignored
    expect(surface).toHaveAttribute("data-variant-id", VAR_COLD_OPEN);
    player.dispatchEvent(new WheelEvent("wheel", { deltaY: 700, bubbles: true })); // deliberate: advances
    await waitFor(() => {
      expect(surface.getAttribute("data-variant-id")).not.toBe(VAR_COLD_OPEN);
    });
  });

  it("renders the sign-language PiP in the vertical safe area, repositionable and resizable", async () => {
    const user = userEvent.setup();
    const { economy, transport } = setup();
    renderPlayer(transport, economy);
    const pip = screen.getByTestId("track-sign");
    // Vertical defaults: left side (clear of the right action rail), small. The fixture carries a real sign
    // clip (0009a sign_video_url), so the PiP renders the video, not the placeholder.
    expect(pip).toHaveAttribute("data-side", "left");
    expect(pip).toHaveAttribute("data-size", "small");
    expect(screen.getByTestId("sign-video")).toBeInTheDocument();
    // One-tap reposition flips the side; the size toggle grows it. Both persist in player state across beats.
    await user.click(screen.getByTestId("sign-reposition"));
    expect(screen.getByTestId("track-sign")).toHaveAttribute("data-side", "right");
    await user.click(screen.getByTestId("sign-size"));
    expect(screen.getByTestId("track-sign")).toHaveAttribute("data-size", "large");
  });

  it("hides the sign PiP when the sign track is turned off", async () => {
    const user = userEvent.setup();
    const { economy, transport } = setup();
    renderPlayer(transport, economy);
    expect(screen.getByTestId("track-sign")).toBeInTheDocument();
    await user.click(screen.getByTestId("player-a11y-open"));
    await user.click(screen.getByTestId("a11y-sign"));
    expect(screen.queryByTestId("track-sign")).not.toBeInTheDocument();
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
