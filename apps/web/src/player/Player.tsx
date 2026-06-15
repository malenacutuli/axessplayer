// The immersive adaptive player, matching the prototype's dark-mode player exactly. A full-bleed
// poster surface (the prototype's calm/tense gradient, or a real muted autoplaying <video> when
// VITE_SCENE_VIDEO_URL is set), a gradient scrim, a top bar (back, the rose adaptive badge YOUR CUT .
// TENSE/CALM, the a11y button), a right rail, a rose scrub bar, the branch-picker pills (Calm cut /
// Tense cut, rose = selected), and the beat info (cut label, title, beat line). Two light sheets slide
// up: the accessibility sheet and the gold-lock paywall sheet.
//
// It drives the REAL decision engine over the SDK: each Continue calls /decide for the cut, advancing
// through the graph (the variant -> beat resolver fixes the advance) to the premium ending, where the
// paywall settles the unlock via /spend. The branch picker lets the viewer feel the per-viewer re-cut
// that the engine normally decides. The media stack (hls.js) is integration-time behind the transport;
// the optional real <video> renders a provided clip through the cuts. No em dashes.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EconomyClient } from "../api/economy.js";
import type { SeriesGraph, VariantNode } from "../api/content.js";
import { variantForBeat, variantToBeatResolver } from "../api/content.js";
import type { Transport } from "@axessplayer/player-sdk";
import { usePlayer } from "./usePlayer.js";
import { A11ySheet } from "../a11y/A11ySheet.js";
import {
  loadA11yPreferences,
  resolveA11y,
  saveA11yPreferences,
  type A11yPreferences,
} from "../a11y/preferences.js";
import { PaywallSheet, type PaywallChoice } from "../wallet/Paywall.js";
import { useUnlock } from "../wallet/useUnlock.js";
import { sceneVideoUrl } from "../config.js";
import { BackIcon, A11yIcon, HeartIcon, CommentIcon, RotateIcon } from "../ui/icons.js";
import { useIsLandscape, requestLandscape, exitLandscape } from "./useOrientation.js";
import { noopCapture, type CaptureClient } from "../capture/capture.js";
import { WhyThisCut, type Adaptation } from "./WhyThisCut.js";

export interface PlayerProps {
  graph: SeriesGraph;
  transport: Transport;
  economy: EconomyClient;
  userId: string;
  startBeatId: string;
  // Back to the feed.
  onBack: () => void;
  // Called when an unlock changes the balance so the shell can refresh the wallet.
  onBalanceChange?: (balance: number) => void;
  // Phase 0 beat-level capture (the flywheel input). Consent-gated by the host: when the viewer has not
  // granted analytics_personalization, the host passes personalize=false and a noop capture, so no events
  // are emitted and no real signals feed /decide. Defaults make the player work standalone (no capture).
  capture?: CaptureClient;
  personalize?: boolean;
}

// The viewer's felt branch. The engine normally decides; the picker lets the viewer override the cut
// shown so they feel the re-cut. "auto" means show whatever the engine served.
type Branch = "auto" | "calm" | "tense";

// Nominal beat length used to turn real dwell time into a completion proxy until the media clock (hls.js)
// is plumbed up from the poster <video>. Dwell is measured; this is the denominator.
const NOMINAL_BEAT_MS = 8000;

export function Player({
  graph,
  transport,
  economy,
  userId,
  startBeatId,
  onBack,
  onBalanceChange,
  capture = noopCapture,
  personalize = false,
}: PlayerProps) {
  const resolveBeatId = useMemo(() => variantToBeatResolver(graph), [graph]);
  const { state, advance, recordSignals } = usePlayer({ transport, userId, startBeatId, resolveBeatId });
  const unlock = useUnlock(economy);

  // Orientation: vertical 9:16 by default; rotate the phone (or tap the rotate button) for full-bleed
  // landscape. deviceLandscape follows the real orientation; manualLandscape is the explicit toggle.
  const playerRef = useRef<HTMLDivElement>(null);
  const deviceLandscape = useIsLandscape();
  const [manualLandscape, setManualLandscape] = useState(false);
  const landscape = deviceLandscape || manualLandscape;
  const toggleLandscape = useCallback(() => {
    setManualLandscape((cur) => {
      const next = !cur;
      if (next) void requestLandscape(playerRef.current);
      else void exitLandscape();
      return next;
    });
  }, []);

  const [prefs, setPrefs] = useState<A11yPreferences>(() => loadA11yPreferences());
  const onPrefsChange = useCallback((next: A11yPreferences) => {
    setPrefs(next);
    saveA11yPreferences(next);
  }, []);

  // The cut currently on screen for the engine's chosen path.
  const engineCut: VariantNode | undefined = useMemo(() => {
    return (
      graph.variants.find((v) => v.id === state.currentVariantId) ??
      variantForBeat(graph, state.currentVariantId)
    );
  }, [graph, state.currentVariantId]);

  // The viewer's felt branch override. Picking a cut shows that variant for the current branch beat.
  const [branch, setBranch] = useState<Branch>("auto");
  const calmVariant = useMemo(() => graph.variants.find((v) => v.intensity <= 2 && !v.is_premium), [graph]);
  const tenseVariant = useMemo(() => graph.variants.find((v) => v.intensity >= 5 && !v.is_premium), [graph]);

  // What is shown: the felt branch override if set, otherwise the engine's cut.
  const shown: VariantNode | undefined =
    branch === "calm" ? calmVariant ?? engineCut : branch === "tense" ? tenseVariant ?? engineCut : engineCut;

  const active = resolveA11y(prefs, shown?.accessibility);
  const availableLanguages = shown?.accessibility?.languages ?? [shown?.language ?? prefs.language];

  // A premium cut at the current beat the viewer has not unlocked gates playback behind the paywall.
  const premiumGate: VariantNode | undefined = useMemo(() => {
    if (!engineCut) return undefined;
    return graph.variants.find((v) => v.beat_id === engineCut.beat_id && v.is_premium);
  }, [graph, engineCut]);

  const unlocked = unlock.state.status === "unlocked";
  const [showPaywall, setShowPaywall] = useState(false);
  const [showA11y, setShowA11y] = useState(false);
  const [showWhy, setShowWhy] = useState(false);

  useEffect(() => {
    if (premiumGate && !unlocked) setShowPaywall(true);
  }, [premiumGate, unlocked]);

  useEffect(() => {
    if (unlocked && unlock.state.balance != null) {
      onBalanceChange?.(unlock.state.balance);
      setShowPaywall(false);
    }
  }, [unlocked, unlock.state.balance, onBalanceChange]);

  const onPaywallChoose = useCallback(
    (choice: PaywallChoice) => {
      if (!premiumGate) return;
      if (choice === "unlock" || choice === "buy") {
        void unlock.unlock("beat_variant", premiumGate.id);
      }
      // watch_ad and subscribe route to the ad / subscription rails (server-verified /grant), flagged
      // as integration-time; presented per the contract PaywallOptions but not wired to a live rail.
    },
    [premiumGate, unlock],
  );

  // The cut shown after an unlock is the premium ending; otherwise whatever is on the branch path.
  const onScreen: VariantNode | undefined = unlocked && premiumGate ? premiumGate : shown;

  // ---------- Phase 0: beat-level capture + REAL /decide signals (was empty {}) ----------
  const currentBeatId = onScreen?.beat_id;
  const lastStep = state.steps[state.steps.length - 1];
  const decisionId = lastStep?.decision.decision_id;
  const isControl = lastStep?.decision.is_control;
  const beatShownAt = useRef<number>(Date.now());
  const sessionStart = useRef<number>(Date.now());
  const replays = useRef<Map<string, number>>(new Map());
  const prevBeat = useRef<string | undefined>(undefined);

  // beat_started on each new on-screen beat; reset the dwell clock and count replays.
  useEffect(() => {
    if (!currentBeatId || prevBeat.current === currentBeatId) return;
    prevBeat.current = currentBeatId;
    beatShownAt.current = Date.now();
    replays.current.set(currentBeatId, (replays.current.get(currentBeatId) ?? 0) + 1);
    capture.emit({
      type: "beat_started",
      beat_id: currentBeatId,
      decision_id: decisionId,
      variant_id: onScreen?.id,
      is_control: isControl,
    });
  }, [currentBeatId, decisionId, isControl, onScreen?.id, capture]);

  // Branch pick: emit choice_made and fold the choice into the next /decide (when personalizing).
  const onPickBranch = useCallback(
    (b: "calm" | "tense") => {
      setBranch(b);
      if (currentBeatId) {
        capture.emit({
          type: "choice_made",
          beat_id: currentBeatId,
          decision_id: decisionId,
          choice: b,
          latency_ms: Date.now() - beatShownAt.current,
        });
      }
      if (personalize) recordSignals({ choice: b });
    },
    [currentBeatId, decisionId, capture, personalize, recordSignals],
  );

  // Continue: measure the just-watched beat and feed REAL signals to /decide (completion, dwell, replays),
  // emit beat_completed, then advance. This is the fix for the empty-signals gap.
  const onContinue = useCallback(() => {
    if (currentBeatId) {
      const dwell = Date.now() - beatShownAt.current;
      const completion = Math.max(0, Math.min(1, dwell / NOMINAL_BEAT_MS));
      capture.emit({
        type: "beat_completed",
        beat_id: currentBeatId,
        decision_id: decisionId,
        variant_id: onScreen?.id,
        completion,
      });
      if (personalize) {
        recordSignals({ completion, dwell_ms: dwell, replays: replays.current.get(currentBeatId) ?? 1 });
      }
    }
    setBranch("auto");
    void advance();
  }, [currentBeatId, decisionId, onScreen?.id, capture, personalize, recordSignals, advance]);

  // Back to feed: close the session.
  const onBackToFeed = useCallback(() => {
    capture.emit({
      type: "session_ended",
      last_beat_id: currentBeatId ?? "",
      total_ms: Date.now() - sessionStart.current,
    });
    void capture.flush();
    onBack();
  }, [capture, currentBeatId, onBack]);

  // The Article 50 disclosure facts: what drove this cut.
  const adaptation: Adaptation = {
    isControl: isControl ?? false,
    language: active.language,
    intensity: onScreen?.intensity,
    captions: active.captions,
    audioDescription: active.audioDescription,
    sign: active.sign,
    policyVersion: lastStep?.decision.policy_version,
    decisionId,
  };

  // Poster surface class: premium gp once unlocked, else calm/tense by the shown cut's intensity.
  const posterClass = unlocked && premiumGate
    ? "gp"
    : (onScreen?.intensity ?? 5) <= 2
      ? "gcalm"
      : "gtense";

  // Adaptive badge label, mirroring the prototype copy.
  const badgeLabel = unlocked && premiumGate
    ? "PREMIUM · UNLOCKED"
    : `YOUR CUT · ${(onScreen?.intensity ?? 5) <= 2 ? "CALM" : "TENSE"}`;

  // Beat line copy, keyed by the felt cut, mirroring the prototype's narrative beats.
  const beatLine = useMemo(() => {
    if (unlocked && premiumGate) {
      return 'Premium ending: "Motion to remove the acting director. All in favor."';
    }
    if ((onScreen?.intensity ?? 5) <= 2) {
      return 'Ch.1 · Rooftop, golden hour: "I never had a job here, Lena. I had a name."';
    }
    return 'Ch.1 · Boardroom standoff: "I am making a transfer of power. The board already signed."';
  }, [unlocked, premiumGate, onScreen]);

  const cutLabel = unlocked && premiumGate ? "Alternate ending unlocked" : "Picked for you in real time";

  return (
    <div
      ref={playerRef}
      className={`player${landscape ? " landscape" : ""}`}
      data-testid="player"
      data-orientation={landscape ? "landscape" : "portrait"}
    >
      <PosterSurface
        posterClass={posterClass}
        variantId={onScreen?.id}
        playbackUrl={onScreen?.playback_url}
      />
      <div className="pgrad" />

      {/* top bar */}
      <div className="ptop">
        <button type="button" className="icbtn" onClick={onBackToFeed} aria-label="Back to feed" data-testid="player-back">
          <BackIcon />
        </button>
        <button
          type="button"
          className="adapt"
          data-testid="adaptive-badge"
          onClick={() => setShowWhy(true)}
          aria-label="Why this cut"
        >
          <span className="dot" aria-hidden="true" />
          {badgeLabel}
        </button>
        <div className="ptop-actions">
          <button
            type="button"
            className="icbtn"
            onClick={toggleLandscape}
            aria-label={landscape ? "Back to vertical" : "Rotate to landscape"}
            aria-pressed={manualLandscape}
            data-testid="player-rotate"
          >
            <RotateIcon />
          </button>
          <button
            type="button"
            className="icbtn"
            onClick={() => setShowA11y(true)}
            aria-label="Accessibility and language"
            data-testid="player-a11y-open"
          >
            <A11yIcon />
          </button>
        </div>
      </div>

      {/* right rail */}
      <div className="prail">
        <div className="rail">
          <span className="c"><HeartIcon /></span>
          12k
        </div>
        <div className="rail">
          <span className="c"><CommentIcon /></span>
          840
        </div>
        <button type="button" className="rail" onClick={() => setShowA11y(true)} aria-label="Accessibility tracks">
          <span className="c"><A11yIcon /></span>
          A11Y
        </button>
      </div>

      {/* scrub bar (rose) */}
      <div className="scrub" aria-hidden="true"><i style={{ width: "62%" }} /></div>

      {/* branch picker pills: feel the per-viewer re-cut */}
      {!unlocked && (
        <div className="branchpick" role="group" aria-label="Pick the cut">
          <button
            type="button"
            className={(branch === "auto" ? (onScreen?.intensity ?? 5) <= 2 : branch === "calm") ? "sel" : undefined}
            onClick={() => onPickBranch("calm")}
            data-testid="branch-calm"
          >
            Calm cut
          </button>
          <button
            type="button"
            className={(branch === "auto" ? (onScreen?.intensity ?? 5) > 2 : branch === "tense") ? "sel" : undefined}
            onClick={() => onPickBranch("tense")}
            data-testid="branch-tense"
          >
            Tense cut
          </button>
        </div>
      )}

      {/* beat info + invisible advance affordance (the engine drive) */}
      <div className="pbody">
        <div className="cut">
          <span className="dot" aria-hidden="true" />
          {cutLabel}
        </div>
        <div className="ptitle">{graph.series.title}</div>
        <p className="psub" data-testid="beat-line">{beatLine}</p>

        <div
          role="region"
          aria-label="Now playing"
          data-testid="player-surface"
          data-variant-id={onScreen?.id ?? ""}
        >
          {active.captions && <p className="player-track" data-testid="track-captions">Captions on</p>}
          {active.audioDescription && (
            <p className="player-track" data-testid="track-audio-description">Audio description on</p>
          )}
          {active.sign && <p className="player-track" data-testid="track-sign">Sign language on</p>}
          <p className="player-track" data-testid="track-language">Language: {active.language}</p>
        </div>

        <button
          type="button"
          className="paybtn"
          style={{ marginTop: 14 }}
          onClick={onContinue}
          disabled={state.advancing || state.ended || showPaywall}
          data-testid="player-advance"
        >
          {state.ended ? "Ended" : state.advancing ? "Loading" : "Continue"}
        </button>
        {state.error && (
          <p role="alert" data-testid="player-error" className="player-track">
            {state.error}
          </p>
        )}
      </div>

      {showA11y && (
        <A11ySheet
          prefs={prefs}
          active={active}
          availableLanguages={availableLanguages}
          onChange={onPrefsChange}
          onClose={() => setShowA11y(false)}
        />
      )}

      {showPaywall && premiumGate && (
        <PaywallSheet
          coinCost={premiumGate.coin_cost}
          balance={unlock.state.balance ?? 0}
          serverOptions={unlock.state.paywall ?? undefined}
          busy={unlock.state.status === "spending"}
          error={unlock.state.status === "error" ? unlock.state.error : null}
          onChoose={onPaywallChoose}
          onDismiss={() => setShowPaywall(false)}
        />
      )}

      <WhyThisCut adaptation={adaptation} open={showWhy} onClose={() => setShowWhy(false)} />
    </div>
  );
}

// True when a variant playback_url points at a directly playable video (an uploaded master on the media
// server, or a plain video file) rather than an HLS playlist or a cdn.example placeholder. Kept in sync
// with apps/studio/src/api/media.ts isPlayableVideoUrl. No em dashes.
function isPlayableVideoUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (/\.(mp4|m4v|mov|webm|ogv|ogg)(\?|$)/i.test(url)) return true;
  return url.includes("/media/");
}

// The full-bleed poster surface. When VITE_SCENE_VIDEO_URL is set, render a real muted autoplaying
// looping <video> (captions/overlay sit on top via the scrim and pbody); otherwise the gradient
// poster. The video is re-seeked to 0 whenever the on-screen cut changes so each cut plays from the
// top. No em dashes.
function PosterSurface({
  posterClass,
  variantId,
  playbackUrl,
}: {
  posterClass: string;
  variantId?: string;
  playbackUrl?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Prefer the per-variant playable video (a real uploaded master), else the global scene clip, else the
  // gradient poster. So a variant uploaded in the Studio actually plays here.
  const url = isPlayableVideoUrl(playbackUrl) ? playbackUrl : sceneVideoUrl();

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    // New cut: restart the clip from the top so each cut reads as its own scene.
    el.currentTime = 0;
    void el.play().catch(() => {
      // Autoplay can be blocked; the muted attribute makes this rare. Non-fatal.
    });
  }, [variantId]);

  if (url) {
    return (
      <div className={`poster ${posterClass}`} data-testid="poster" data-scene-video="true">
        <video
          ref={videoRef}
          src={url}
          muted
          autoPlay
          loop
          playsInline
          // Keep the gradient as the poster fallback before the clip paints.
          poster=""
          data-playback-url={playbackUrl ?? ""}
        />
      </div>
    );
  }

  return (
    <div
      className={`poster ${posterClass}`}
      data-testid="poster"
      data-playback-url={playbackUrl ?? ""}
    />
  );
}
