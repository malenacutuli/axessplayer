// 20-V5 test: the premium-cut merchandising sheet. It loads cuts from the CUTS API CONTRACT, shows owned
// vs locked from the wallet entitlements, buys via the EXISTING economy /spend with a stable
// client_txn_id (idempotent, own-once), grants the entitlement on success, and emits the canonical
// premium_cut / unlock / credits_spent events. Anti-dark-pattern: transparent pricing, no live rail.
// No em dashes.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UnlockCutsSheet } from "./UnlockCutsSheet.js";
import type { CutsClient, BeatCuts } from "../api/cuts.js";
import type { EconomyClient, Wallet, SpendResult } from "../api/economy.js";
import type { ViewerAnalytics } from "../analytics/analytics.js";

const BEATS: BeatCuts[] = [
  {
    beatId: "beat-1",
    beatLabel: "Ch.1 Boardroom",
    cuts: [
      { variantId: "v-alt", kind: "alt_ending", label: "She signs", coinCost: 5, isPremium: true },
      { variantId: "v-pov", kind: "pov", label: "His side", coinCost: 3, isPremium: true },
      { variantId: "v-int", kind: "intensity", label: "Darker", coinCost: 4, isPremium: true },
    ],
  },
];

function makeCuts(beats: BeatCuts[] = BEATS): CutsClient {
  return { getSeriesCuts: vi.fn(async () => beats) };
}

function makeAnalytics(): ViewerAnalytics & { track: ReturnType<typeof vi.fn> } {
  return { track: vi.fn() };
}

function wallet(balance: number, entitlements: Wallet["entitlements"] = []): Wallet {
  return { user_id: "u1", balance, bonus_balance: 0, entitlements };
}

function makeEconomy(opts: { wallet: Wallet; spend?: EconomyClient["spend"] }): EconomyClient {
  return {
    getWallet: vi.fn(async () => opts.wallet),
    spend:
      opts.spend ??
      vi.fn(async (body) => ({
        balance: opts.wallet.balance - 5,
        entitlement: { scope: "beat_variant", scope_id: body.scope_id },
      } as SpendResult)),
  };
}

describe("UnlockCutsSheet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("merchandises the cut types with transparent prices and emits premium_cut_shown + unlock_shown", async () => {
    const analytics = makeAnalytics();
    const economy = makeEconomy({ wallet: wallet(20) });
    render(
      <UnlockCutsSheet
        seriesId="s1"
        cuts={makeCuts()}
        economy={economy}
        analytics={analytics}
        surface="player"
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText("Alternate ending")).toBeInTheDocument();
    expect(screen.getByText("His / Her POV")).toBeInTheDocument();
    expect(screen.getByText("Intensity+")).toBeInTheDocument();
    await waitFor(() =>
      expect(analytics.track).toHaveBeenCalledWith("premium_cut_shown", expect.objectContaining({ seriesId: "s1" })),
    );
    expect(analytics.track).toHaveBeenCalledWith(
      "unlock_shown",
      expect.objectContaining({ variantId: "v-alt", beatId: "beat-1" }),
    );
  });

  it("shows owned cuts (from wallet entitlements) as owned, not purchasable", async () => {
    const economy = makeEconomy({ wallet: wallet(20, [{ scope: "beat_variant", scope_id: "v-pov" }]) });
    render(
      <UnlockCutsSheet
        seriesId="s1"
        cuts={makeCuts()}
        economy={economy}
        analytics={makeAnalytics()}
        surface="player"
        onClose={() => {}}
      />,
    );
    expect(await screen.findByTestId("cut-owned-v-pov")).toBeInTheDocument();
    expect(screen.queryByTestId("cut-buy-v-pov")).not.toBeInTheDocument();
    // The unowned ones are still purchasable.
    expect(screen.getByTestId("cut-buy-v-alt")).toBeInTheDocument();
  });

  it("buys via economy /spend with a stable client_txn_id and emits the purchase events", async () => {
    const analytics = makeAnalytics();
    const spend = vi.fn(async (body: { scope: string; scope_id: string; client_txn_id: string }) => ({
      balance: 15,
      entitlement: { scope: "beat_variant", scope_id: body.scope_id },
    } as SpendResult));
    const economy = makeEconomy({ wallet: wallet(20), spend });
    const onUnlocked = vi.fn();
    const user = userEvent.setup();
    render(
      <UnlockCutsSheet
        seriesId="s1"
        cuts={makeCuts()}
        economy={economy}
        analytics={analytics}
        surface="player"
        onClose={() => {}}
        onUnlocked={onUnlocked}
      />,
    );
    const buy = await screen.findByTestId("cut-buy-v-alt");
    await user.click(buy);

    await waitFor(() => expect(spend).toHaveBeenCalledTimes(1));
    const call = spend.mock.calls[0][0];
    expect(call.scope).toBe("beat_variant");
    expect(call.scope_id).toBe("v-alt");
    expect(typeof call.client_txn_id).toBe("string");
    expect(call.client_txn_id.length).toBeGreaterThan(0);

    expect(onUnlocked).toHaveBeenCalledWith("v-alt");
    expect(analytics.track).toHaveBeenCalledWith("premium_cut_purchased", expect.objectContaining({ variantId: "v-alt" }));
    expect(analytics.track).toHaveBeenCalledWith("unlock_purchased", expect.objectContaining({ variantId: "v-alt" }));
    expect(analytics.track).toHaveBeenCalledWith("credits_spent", expect.objectContaining({ variantId: "v-alt" }));

    // The cut now shows as owned (own-once).
    expect(await screen.findByTestId("cut-owned-v-alt")).toBeInTheDocument();
  });

  it("renders an empty state when the series has no cuts", async () => {
    render(
      <UnlockCutsSheet
        seriesId="s1"
        cuts={makeCuts([{ beatId: "b", beatLabel: "B", cuts: [] }])}
        economy={makeEconomy({ wallet: wallet(0) })}
        analytics={makeAnalytics()}
        surface="series_detail"
        onClose={() => {}}
      />,
    );
    expect(await screen.findByTestId("unlock-cuts-empty")).toBeInTheDocument();
  });

  it("is a labelled modal dialog with a working close", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <UnlockCutsSheet
        seriesId="s1"
        cuts={makeCuts()}
        economy={makeEconomy({ wallet: wallet(20) })}
        analytics={makeAnalytics()}
        surface="player"
        onClose={onClose}
      />,
    );
    expect(screen.getByRole("dialog", { name: /unlock more of this story/i })).toBeInTheDocument();
    await user.click(await screen.findByTestId("unlock-cuts-close"));
    expect(onClose).toHaveBeenCalled();
  });
});
