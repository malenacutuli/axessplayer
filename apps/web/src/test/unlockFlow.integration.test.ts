// Integration test: the full unlock flow against the stateful mock server (the Prism-mock stand-in).
// It browses the graph, plays the adaptive episode to the premium ending, unlocks it via /spend, and
// reconciles the balance. It then asserts the F1 trust boundary: NO request body sent by the web
// client ever carries a user_id (identity rides the session bearer), across content, economy,
// decision, and manifest calls.
//
// Real device playback and true seamless switching are W5 on-hardware (integration-time); this proves
// the contract calls and the orchestration the UI drives. No em dashes.

import { describe, it, expect } from "vitest";
import { createMockServer } from "./mockServer.js";
import { buildClients } from "../clients.js";
import { staticSession } from "../api/session.js";
import { BranchingPlayer } from "@axessplayer/player-sdk";
import {
  SERIES_ID,
  VAR_ENDING_PREMIUM,
  BEAT_COLD_OPEN,
} from "./fixtures.js";

const BASE = "http://mock";

function clientsFor(server: ReturnType<typeof createMockServer>) {
  return buildClients({
    session: staticSession("integration-token"),
    fetch: server.fetch,
    config: {
      contentBaseUrl: BASE,
      economyBaseUrl: BASE,
      decisionBaseUrl: BASE,
      manifestBaseUrl: BASE,
    },
  });
}

describe("unlock flow (integration)", () => {
  it("browses, plays to the ending, and unlocks the premium cut", async () => {
    const server = createMockServer({ balance: 10 });
    const clients = clientsFor(server);

    // Browse: resolve the series graph.
    const graph = await clients.content.getSeriesGraph(SERIES_ID);
    expect(graph.series.title).toBe("The Last Signal");

    // Wallet: read the starting balance from the server (authoritative).
    const wallet0 = await clients.economy.getWallet();
    expect(wallet0.balance).toBe(10);

    // Play the adaptive episode over the SDK: decide -> prefetch -> seamless switch, to the 422 end.
    const stripped: string[] = [];
    const transport = clients.playerTransport((id) => stripped.push(id));
    const player = new BranchingPlayer({ transport, userId: "viewer-id", startBeatId: BEAT_COLD_OPEN });
    const steps = await player.play();
    expect(steps.length).toBeGreaterThan(0);
    // The web transport stripped the user_id the SDK put in the decide body (F1) on every /decide,
    // including the final boundary call that returns the 422 end-of-graph. So at least one strip per
    // played step occurred.
    expect(stripped.length).toBeGreaterThanOrEqual(steps.length);

    // Unlock the premium ending via /spend. Server derives the price (5) and grants the entitlement.
    const spend = await clients.economy.spend({
      scope: "beat_variant",
      scope_id: VAR_ENDING_PREMIUM,
      client_txn_id: "txn-1",
    });
    expect(spend.balance).toBe(5);
    expect(spend.entitlement.scope_id).toBe(VAR_ENDING_PREMIUM);

    // Idempotency: replaying the same client_txn_id is a no-op and returns the same balance.
    const replay = await clients.economy.spend({
      scope: "beat_variant",
      scope_id: VAR_ENDING_PREMIUM,
      client_txn_id: "txn-1",
    });
    expect(replay.balance).toBe(5);

    // Reconcile: the wallet reflects the deduction and the new entitlement.
    const wallet1 = await clients.economy.getWallet();
    expect(wallet1.balance).toBe(5);
    expect(wallet1.entitlements.some((e) => e.scope_id === VAR_ENDING_PREMIUM)).toBe(true);

    // F1 ASSERTION: no request body sent across the whole flow carries a user id.
    for (const body of server.bodies()) {
      expect(body).not.toHaveProperty("user_id");
      expect(body).not.toHaveProperty("userId");
      expect(body).not.toHaveProperty("uid");
    }

    // Identity rode the session token: every POST that carried a body also carried an auth header.
    const postsWithBody = server.requests.filter((r) => r.method === "POST" && r.body);
    expect(postsWithBody.length).toBeGreaterThan(0);
    for (const r of postsWithBody) {
      expect(r.hasAuthHeader).toBe(true);
    }
  });

  it("reflects a 402 PaywallOptions when the viewer cannot afford the unlock", async () => {
    const server = createMockServer({ balance: 0 });
    const clients = clientsFor(server);

    await expect(
      clients.economy.spend({ scope: "beat_variant", scope_id: VAR_ENDING_PREMIUM, client_txn_id: "txn-x" }),
    ).rejects.toMatchObject({ name: "PaywallError" });

    // Even the failed spend body carried no user id.
    for (const body of server.bodies()) {
      expect(body).not.toHaveProperty("user_id");
    }
  });
});
