// The adaptive player SCREEN controller (no rendering). It owns the play session for one episode card:
// it picks the accessibility-correct starting cut, runs the player-sdk BranchingPlayer (which calls
// /decide, prefetches candidates, and resolves the seamless switch with NO menu and NO visible
// adaptation), and gates a premium beat behind the wallet paywall before letting playback continue.
//
// SCOPE / FLAG: this drives the decision + prefetch + switch ORCHESTRATION through the SDK and proves the
// UI control flow. It does NOT do real media playback: device-level frame-accurate cut-over and true
// seamlessness need real hardware and the W5 on-hardware media stack, and are flagged as integration-time
// verification, not claimed here. No em dashes.

import { BranchingPlayer, type BranchStep } from "@axessplayer/player-sdk";

import type { ApiClient } from "../api/client.js";
import type { AppConfig } from "../api/config.js";
import {
  activeAccessibility,
  selectVariant,
  type AccessibilityPreferences,
  type ActiveAccessibility,
} from "../accessibility/preferences.js";
import type { BeatNode } from "../feed/graph.js";
import { hasEntitlement, unlock, type UnlockOutcome } from "../wallet/wallet.js";
import type { Wallet } from "../api/types.js";
import { createPlayerTransport } from "./transport.js";

export interface PlayerSessionOptions {
  config: AppConfig;
  // The session subject (the bearer subject). Required by the player SDK and the frozen decision
  // contract's /decide body. NOTE: this is NOT something the app puts in an economy body (F1); it is the
  // decision contract's own field, owned by W3/W5. See src/player/transport.ts for the contract-change
  // request to remove it from the decision body.
  userId: string;
  // The beat the episode opens on (from the feed item's coldOpenBeatId).
  startBeatId: string;
  prefs: AccessibilityPreferences;
}

// What the screen renders for the currently playing cut.
export interface NowPlaying {
  variantId: string;
  // Whether the switch into this cut was seamless (chosen cut was buffered). Reported for the gap audit
  // and the integration check; the viewer never sees a menu or a quality choice.
  seamless: boolean;
  accessibility: ActiveAccessibility;
}

// A premium beat the viewer reached but is not yet entitled to. The screen presents the paywall here.
export interface PaywallGate {
  scope: "beat_variant";
  scopeId: string;
  estimatedCost: number;
}

// The player session: a thin controller around BranchingPlayer plus the a11y + paywall gating the SDK
// does not own. One per viewing session.
export class PlayerSession {
  private readonly player: BranchingPlayer;
  private readonly prefs: AccessibilityPreferences;

  constructor(opts: PlayerSessionOptions) {
    this.prefs = opts.prefs;
    this.player = new BranchingPlayer({
      transport: createPlayerTransport(opts.config),
      userId: opts.userId,
      startBeatId: opts.startBeatId,
    });
  }

  // Forward the viewer's beat-level behavior into the next /decide (completion, dwell, replays, skip,
  // choice). The screen calls this from its playback callbacks; the SDK folds them into the next decision.
  recordSignals(...args: Parameters<BranchingPlayer["recordSignals"]>): void {
    this.player.recordSignals(...args);
  }

  updateBandwidth(kbps: number): void {
    this.player.updateBandwidth(kbps);
  }

  // Advance to the next branch point: ask /decide, prefetch, resolve the seamless switch. Returns the
  // SDK's BranchStep; map it to NowPlaying with mapNowPlaying once the beat's a11y variant is known.
  advance(): Promise<BranchStep> {
    return this.player.advance();
  }
}

// Resolve the accessibility-correct cut for a beat and the a11y affordances to render as ON. Used for the
// cold-open beat and any beat the screen has the graph node for. The player SDK chooses the next variant
// by signals; this layer expresses the viewer's a11y INTENT for the starting cut and the rendered tracks.
export function resolveBeatAccessibility(
  beat: BeatNode,
  prefs: AccessibilityPreferences
): { variantId: string | undefined; accessibility: ActiveAccessibility | undefined } {
  const variant = selectVariant(beat, prefs);
  return {
    variantId: variant?.id,
    accessibility: variant ? activeAccessibility(variant, prefs) : undefined,
  };
}

// Decide whether a premium beat must hit the paywall before it plays: premium AND not already entitled.
// Returns the gate to present, or null to play straight through. The wallet is the SERVER's, never local
// truth.
export function paywallGateForBeat(
  beat: BeatNode,
  wallet: Wallet
): PaywallGate | null {
  const premium = beat.variants.find((v) => v.isPremium);
  if (!premium) return null;
  if (hasEntitlement(wallet, "beat_variant", premium.id)) return null;
  return {
    scope: "beat_variant",
    scopeId: premium.id,
    estimatedCost: premium.coinCost ?? 0,
  };
}

// Drive the unlock from the screen's paywall: calls /spend (no user_id, F1) and returns the outcome the
// screen renders (unlocked / re-present paywall options / route to sign-in). The caller reconciles the
// wallet on success.
export function unlockGate(
  client: ApiClient,
  gate: PaywallGate
): Promise<UnlockOutcome> {
  return unlock(client, gate.scope, gate.scopeId);
}
