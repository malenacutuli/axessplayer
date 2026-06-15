// Drives the adaptive player over packages/player-sdk. The BranchingPlayer (W5 IP) does the work:
// at each beat boundary it calls /decide, prefetches the chosen cut plus top-k hints, and resolves
// the seamless switch, looping until the contract 422 ends the graph. There is no quality menu: the
// adaptation is invisible (brief design 2). This hook records each resolved BranchStep so the screen
// can show the cut that played and whether it was seamless.
//
// Device-level frame-accurate cut-over (hls.js + MSE) is W5's on-hardware phase behind the transport;
// this hook proves the decision + prefetch + switch ORCHESTRATION and the contract calls. Real media
// playback is flagged as integration-time, not faked. No em dashes.

import { useCallback, useMemo, useRef, useState } from "react";
import { BranchingPlayer, type BranchStep } from "@axessplayer/player-sdk";
import type { Transport } from "@axessplayer/player-sdk";

export interface UsePlayerOptions {
  transport: Transport;
  // The viewer id. NOTE: this is handed to the SDK BranchingPlayer because the decision contract
  // (0.3.1) types the /decide body with user_id. The web transport STRIPS it before the wire and
  // sends the session bearer instead (F1). See webTransport.ts and the report's contract-change note.
  userId: string;
  startBeatId: string;
  // Map a chosen cut's VARIANT id to the BEAT id the next /decide must be made from. The web host
  // builds this from the content graph (variants carry beat_id), fixing the variant-vs-beat advance.
  resolveBeatId?: (chosenVariantId: string) => string;
}

export interface PlayerState {
  steps: BranchStep[];
  // The cut currently on screen (the last played variant), or the cold open before the first advance.
  currentVariantId: string;
  ended: boolean;
  advancing: boolean;
  error: string | null;
}

export interface UsePlayer {
  state: PlayerState;
  // Advance one beat boundary (decide, prefetch, seamless switch). Resolves when the cut is resolved.
  advance: () => Promise<void>;
  // Report viewer beat-level behavior, folded into the next /decide (brief design 5).
  recordSignals: (signals: { completion?: number; dwell_ms?: number; replays?: number; skipped?: boolean; choice?: string }) => void;
  // Update the measured downlink, driving the low-bandwidth switch fallback.
  updateBandwidth: (kbps: number) => void;
}

export function usePlayer(opts: UsePlayerOptions): UsePlayer {
  const player = useMemo(
    () =>
      new BranchingPlayer({
        transport: opts.transport,
        userId: opts.userId,
        startBeatId: opts.startBeatId,
        resolveBeatId: opts.resolveBeatId,
      }),
    [opts.transport, opts.userId, opts.startBeatId, opts.resolveBeatId],
  );

  const [state, setState] = useState<PlayerState>({
    steps: [],
    currentVariantId: opts.startBeatId,
    ended: false,
    advancing: false,
    error: null,
  });

  const advancing = useRef(false);

  const advance = useCallback(async () => {
    if (advancing.current || state.ended) return;
    advancing.current = true;
    setState((s) => ({ ...s, advancing: true, error: null }));
    try {
      const step = await player.advance();
      setState((s) => ({
        ...s,
        steps: [...s.steps, step],
        currentVariantId: step.played.variantId,
        advancing: false,
      }));
    } catch (err) {
      // The SDK rejects NoSuccessorsError at the end of the graph; that is a clean stop, not an error.
      const isEnd =
        err && typeof err === "object" && "status" in err && (err as { status: number }).status === 422;
      setState((s) => ({
        ...s,
        ended: isEnd ? true : s.ended,
        advancing: false,
        error: isEnd ? null : err instanceof Error ? err.message : "playback error",
      }));
    } finally {
      advancing.current = false;
    }
  }, [player, state.ended]);

  const recordSignals = useCallback(
    (signals: Parameters<UsePlayer["recordSignals"]>[0]) => player.recordSignals(signals),
    [player],
  );

  const updateBandwidth = useCallback((kbps: number) => player.updateBandwidth(kbps), [player]);

  return { state, advance, recordSignals, updateBandwidth };
}
