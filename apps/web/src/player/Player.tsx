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

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
import { attachHls } from "./hls.js";
import { SignPip, type SignSide, type SignSize } from "./SignPip.js";
import { useSwipeNavigation, prefetchMedia } from "./useSwipeNavigation.js";
import { CaptionsWithIntention } from "./a11y/CaptionsWithIntention.js";
import type { CaptionSegment } from "./a11y/captionsModel.js";

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
  const playerRef = useRef<HTMLDivElement | null>(null);
  // Track the player element in state too, so the swipe-navigation effect attaches once it mounts.
  const [playerEl, setPlayerEl] = useState<HTMLDivElement | null>(null);
  const setPlayerNode = useCallback((node: HTMLDivElement | null) => {
    playerRef.current = node;
    setPlayerEl(node);
  }, []);
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

  // 0009a captions: the video clock (ms) plus the fetched CaptionSegment[] document for the on-screen cut.
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [captionSegments, setCaptionSegments] = useState<CaptionSegment[]>([]);
  // Timeline: duration + play state + a handle to the video element's controls (seek/toggle) so the scrubber
  // can seek and the viewer can go back.
  const [durationMs, setDurationMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const videoControls = useRef<VideoControls | null>(null);

  // Vertical layout of the sign-language PiP: viewport-relative, repositionable (left/right) and resizable.
  // Held in player state so it carries across beats in a session without re-prompting (swipe-feed requirement).
  const [signSide, setSignSide] = useState<SignSide>("left");
  const [signSize, setSignSize] = useState<SignSize>("small");
  const toggleSignSide = useCallback(() => setSignSide((s) => (s === "left" ? "right" : "left")), []);
  const toggleSignSize = useCallback(() => setSignSize((s) => (s === "small" ? "large" : "small")), []);

  // The beat the player is on (currentVariantId is a beat id at start, a variant id after advancing).
  const activeBeatId = useMemo(() => {
    const v = graph.variants.find((x) => x.id === state.currentVariantId);
    return v?.beat_id ?? state.currentVariantId;
  }, [graph, state.currentVariantId]);

  // The REAL, ready cuts for this beat: a /media URL and qa_status passed. Seed placeholders (cdn.example,
  // qa pending) are excluded so they can NEVER be selected and blacken the player.
  const realBeatVariants = useMemo(
    () =>
      graph.variants.filter(
        (v) => v.beat_id === activeBeatId && v.qa_status === "passed" && isPlayableVideoUrl(v.playback_url),
      ),
    [graph, activeBeatId],
  );

  // The engine's chosen cut, constrained to real media: the engine-chosen variant if it has real media, else
  // the first real variant for the beat, else the raw cut (so the UI shows an explicit "no media" state, not
  // silent navy).
  const engineCut: VariantNode | undefined = useMemo(() => {
    const chosen = graph.variants.find((v) => v.id === state.currentVariantId);
    if (chosen && chosen.qa_status === "passed" && isPlayableVideoUrl(chosen.playback_url)) return chosen;
    return realBeatVariants[0] ?? chosen ?? variantForBeat(graph, activeBeatId);
  }, [graph, state.currentVariantId, realBeatVariants, activeBeatId]);

  // The viewer's felt branch override. Calm/tense are resolved to REAL, ready cuts only (passed + /media), so
  // picking a cut can never land on a seed placeholder with no media. If no real calm/tense cut exists, the
  // picker falls back to the engine's (real) cut rather than blackening the screen.
  const [branch, setBranch] = useState<Branch>("auto");
  const calmVariant = useMemo(
    () =>
      graph.variants.find(
        (v) => v.intensity <= 2 && !v.is_premium && v.qa_status === "passed" && isPlayableVideoUrl(v.playback_url),
      ),
    [graph],
  );
  const tenseVariant = useMemo(
    () =>
      graph.variants.find(
        (v) => v.intensity >= 5 && !v.is_premium && v.qa_status === "passed" && isPlayableVideoUrl(v.playback_url),
      ),
    [graph],
  );

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

  // Never hand the surface a cut whose media does not exist (a black player). If the chosen cut has no
  // playable URL, fall back to a sibling variant on the same beat that does (qa passed + real media). This is
  // the guard against the engine picking a language/cut that was never uploaded.
  const playable: VariantNode | undefined = useMemo(() => {
    if (!onScreen) return onScreen;
    if (isPlayableVideoUrl(onScreen.playback_url)) return onScreen;
    const sibling = graph.variants.find(
      (v) => v.beat_id === onScreen.beat_id && v.qa_status === "passed" && isPlayableVideoUrl(v.playback_url),
    );
    return sibling ?? onScreen;
  }, [graph, onScreen]);

  // Log the variant URL the player actually received, so a dark frame is diagnosable from the console.
  useEffect(() => {
    if (playable) {
      // eslint-disable-next-line no-console
      console.info(
        `[player] beat=${playable.beat_id} variant=${playable.id} lang=${playable.language} url=${playable.playback_url}`,
      );
    }
  }, [playable?.id, playable?.playback_url, playable?.beat_id, playable?.language, playable]);

  // 0009a: fetch the caption document (CaptionSegment[]) for the on-screen cut. Tolerant of {segments:[...]}
  // or a bare array. Cleared when the cut has no caption_doc_url, so captions reflect the current variant.
  useEffect(() => {
    const docUrl = playable?.caption_doc_url;
    if (!docUrl) {
      setCaptionSegments([]);
      return;
    }
    let alive = true;
    void fetch(docUrl)
      .then((r) => (r.ok ? r.json() : null))
      .then((doc: unknown) => {
        if (!alive) return;
        const segs = Array.isArray(doc)
          ? (doc as CaptionSegment[])
          : ((doc as { segments?: CaptionSegment[] })?.segments ?? []);
        setCaptionSegments(segs);
      })
      .catch((err) => {
        if (alive) {
          setCaptionSegments([]);
          console.warn("[player] caption doc load failed", err, docUrl);
        }
      });
    return () => {
      alive = false;
    };
  }, [playable?.caption_doc_url]);

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

  // Swipe-feed navigation: an upward swipe / wheel-down / ArrowDown advances to the next beat, inert while the
  // paywall is open, a switch is in flight, or the graph ended.
  useSwipeNavigation(playerEl, onContinue, {
    enabled: !showPaywall && !state.advancing && !state.ended,
  });

  // Always-available escape: Esc closes any open sheet so the player can never be trapped behind a modal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowWhy(false);
        setShowA11y(false);
        setShowPaywall(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Prefetch the immediate alternate cuts (calm/tense/premium) so switching or advancing has no buffering.
  useEffect(() => {
    prefetchMedia([calmVariant?.playback_url, tenseVariant?.playback_url, premiumGate?.playback_url]);
  }, [currentBeatId, calmVariant?.playback_url, tenseVariant?.playback_url, premiumGate?.playback_url]);

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
  // Honest language: the cut actually on screen, not a preference guess that may not be offered.
  const adaptation: Adaptation = {
    isControl: isControl ?? false,
    language: playable?.language ?? active.language,
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
      ref={setPlayerNode}
      className={`player${landscape ? " landscape" : ""}`}
      data-testid="player"
      data-orientation={landscape ? "landscape" : "portrait"}
      tabIndex={0}
    >
      <PosterSurface
        posterClass={posterClass}
        variantId={playable?.id}
        playbackUrl={playable?.playback_url}
        onTimeMs={setCurrentTimeMs}
        onDurationMs={setDurationMs}
        onPlayingChange={setPlaying}
        controlsRef={videoControls}
      />
      <div className="pgrad" />

      {/* Build marker so a stale bundle is obvious: if you do NOT see this pill, the browser is on old code. */}
      <div
        data-testid="player-build"
        style={{
          position: "absolute",
          top: 6,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 50,
          background: "var(--rose, #FF2E6E)",
          color: "#fff",
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: "0.04em",
          padding: "2px 8px",
          borderRadius: 999,
          pointerEvents: "none",
        }}
      >
        build PLAYER-TIMELINE
      </div>

      {/* top bar */}
      <div className="ptop">
        <button type="button" className="icbtn" onClick={onBackToFeed} aria-label="Back to feed" data-testid="player-back">
          <BackIcon />
        </button>
        <button
          type="button"
          className="adapt"
          data-testid="adaptive-badge"
          onClick={() => {
            setShowA11y(false);
            setShowWhy(true);
          }}
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
            onClick={() => {
              setShowWhy(false);
              setShowA11y(true);
            }}
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
        <button
          type="button"
          className="rail"
          onClick={() => {
            setShowWhy(false);
            setShowA11y(true);
          }}
          aria-label="Accessibility tracks"
        >
          <span className="c"><A11yIcon /></span>
          A11Y
        </button>
      </div>

      {/* real timeline: play/pause, seekable scrubber (go back), and the time readout */}
      <Scrubber
        currentMs={currentTimeMs}
        durationMs={durationMs}
        playing={playing}
        onSeek={(ms) => videoControls.current?.seek(ms)}
        onToggle={() => videoControls.current?.toggle()}
      />

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
          {/* Audio description and language are non-visual indicators; captions render in the safe area
              below and sign language in the vertical PiP, so they clear the controls and the action rail. */}
          {active.audioDescription && (
            <p className="player-track" data-testid="track-audio-description">Audio description on</p>
          )}
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
        {!state.ended && !showPaywall && (
          <p className="player-track" data-testid="swipe-hint" style={{ opacity: 0.7, marginTop: 6 }}>
            Swipe up for the next beat
          </p>
        )}
        {state.error && (
          <p role="alert" data-testid="player-error" className="player-track">
            {state.error}
          </p>
        )}
      </div>

      {/* Caption safe area: above the control bar and clear of the right action rail, line length capped for
          legibility at vertical width. The captions-with-intention renderer lifted from Axessible draws the
          real word-level caption document here once 0009a wires caption_doc_url; today it shows the caption
          state so the vertical placement is provable (Work item A). */}
      {active.captions && (
        <div className="cap-safe" data-testid="track-captions" style={CAP_SAFE_STYLE}>
          {captionSegments.length > 0 ? (
            <CaptionsWithIntention segments={captionSegments} currentTimeMs={currentTimeMs} enabled />
          ) : (
            // No caption document on this cut yet (0009a not wired for it): keep the honest indicator.
            <span style={{ opacity: 0.7, fontSize: 13 }}>Captions on (no caption track for this cut)</span>
          )}
        </div>
      )}

      <SignPip
        active={active.sign}
        side={signSide}
        size={signSize}
        onToggleSide={toggleSignSide}
        onToggleSize={toggleSignSize}
      />

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

// Caption safe area for the 9:16 frame: sit above the control bar and branch picker (bottom), inset on the
// right to clear the action rail, and cap the line length so captions stay legible at vertical width.
const CAP_SAFE_STYLE: CSSProperties = {
  position: "absolute",
  bottom: "22vh",
  left: "5vw",
  right: "18vw",
  maxWidth: 560,
  margin: "0 auto",
  textAlign: "center",
  color: "#fff",
  lineHeight: 1.3,
  zIndex: 5,
  pointerEvents: "none",
};

// True when a variant playback_url points at a directly playable video (an uploaded master on the media
// server, or a plain video file) rather than an HLS playlist or a cdn.example placeholder. Kept in sync
// with apps/studio/src/api/media.ts isPlayableVideoUrl. No em dashes.
function isPlayableVideoUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (/\.(mp4|m4v|mov|webm|ogv|ogg)(\?|$)/i.test(url)) return true;
  return url.includes("/media/");
}

// Imperative handle to the video element so the chrome (scrubber) can seek and toggle playback.
interface VideoControls {
  seek: (ms: number) => void;
  toggle: () => void;
}

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// A real, seekable timeline for the vertical player: play/pause, a draggable progress track (tap or drag to
// go back/forward), and the time readout. No em dashes.
function Scrubber({
  currentMs,
  durationMs,
  playing,
  onSeek,
  onToggle,
}: {
  currentMs: number;
  durationMs: number;
  playing: boolean;
  onSeek: (ms: number) => void;
  onToggle: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const pct = durationMs > 0 ? Math.min(100, (currentMs / durationMs) * 100) : 0;
  const seekAtClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el || durationMs <= 0) return;
    const r = el.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    onSeek(frac * durationMs);
  };
  return (
    <div className="scrubrow" data-testid="scrubrow" style={{ position: "absolute", left: 14, right: 14, bottom: "9vh", zIndex: 6, display: "flex", alignItems: "center", gap: 10 }}>
      <button
        type="button"
        className="icbtn"
        data-testid="player-playpause"
        aria-label={playing ? "Pause" : "Play"}
        onClick={onToggle}
        style={{ flex: "0 0 auto", fontSize: 16, lineHeight: 1 }}
      >
        {playing ? "❚❚" : "▶"}
      </button>
      <div
        ref={trackRef}
        className="scrub"
        data-testid="scrubber"
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs / 1000)}
        aria-valuenow={Math.round(currentMs / 1000)}
        tabIndex={0}
        style={{ flex: 1, cursor: "pointer" }}
        onClick={(e) => seekAtClientX(e.clientX)}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          seekAtClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 1) seekAtClientX(e.clientX);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") onSeek(Math.max(0, currentMs - 5000));
          else if (e.key === "ArrowRight") onSeek(Math.min(durationMs, currentMs + 5000));
        }}
      >
        <i style={{ width: `${pct}%` }} />
      </div>
      <span className="time" data-testid="player-time" style={{ flex: "0 0 auto", fontSize: 11, fontVariantNumeric: "tabular-nums", opacity: 0.85 }}>
        {fmtTime(currentMs)} / {fmtTime(durationMs)}
      </span>
    </div>
  );
}

// The full-bleed poster surface. When VITE_SCENE_VIDEO_URL is set, render a real muted autoplaying
// looping <video> (captions/overlay sit on top via the scrim and pbody); otherwise the gradient
// poster. The video is re-seeked to 0 whenever the on-screen cut changes so each cut plays from the
// top. No em dashes.
function PosterSurface({
  posterClass,
  variantId,
  playbackUrl,
  fit = "cover",
  onTimeMs,
  onDurationMs,
  onPlayingChange,
  controlsRef,
}: {
  posterClass: string;
  variantId?: string;
  playbackUrl?: string;
  // Report the video clock (ms) so captions / AD / sign sync to playback.
  onTimeMs?: (ms: number) => void;
  // Report duration (ms) and play state so the timeline can render, and expose seek/toggle controls.
  onDurationMs?: (ms: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  controlsRef?: { current: VideoControls | null };
  // Fit policy for the 9:16 frame. "cover" is correct for vertical-native content; "contain" letterboxes a
  // landscape source so faces are never silently cropped. This is a per-variant hint: the source is gated
  // behind 0009 (a variant fit column); until then the default is cover.
  fit?: "cover" | "contain";
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // Visible playback status, so a black frame is diagnosable on screen (the user can read it back).
  const [status, setStatus] = useState<string>("idle");
  // Whether the video is actually painting frames. When paused (incl. blocked autoplay) we show a clear
  // "Tap to play" overlay so the player is NEVER a blank black screen that looks broken.
  const [paused, setPaused] = useState(true);
  // Sound: the clip autoplays MUTED (browsers block unmuted autoplay), then the viewer taps to enable sound.
  // soundOnRef lets the attach effect unmute a freshly switched cut without re-subscribing.
  const [soundOn, setSoundOn] = useState(false);
  const soundOnRef = useRef(false);
  soundOnRef.current = soundOn;
  // A user tap: start playback (a guaranteed user gesture). Reports its result into the status line so a
  // "nothing happens" tap is diagnosable: readyState (0 = no media buffered) and any rejection reason.
  const tapToPlay = () => {
    const el = videoRef.current;
    if (!el) {
      setStatus("tap: no video element");
      return;
    }
    setSoundOn(true);
    el.muted = false;
    setStatus(`tap: play rs=${el.readyState} net=${el.networkState}`);
    const p = el.play();
    if (p && typeof p.then === "function") {
      p.then(() => {
        setStatus(`tap: playing rs=${el.readyState}`);
        setPaused(false);
      }).catch((e: unknown) => {
        const name = (e as Error)?.name ?? "?";
        // Unmuted play rejected: retry MUTED (still a gesture).
        el.muted = true;
        const p2 = el.play();
        if (p2 && typeof p2.then === "function") {
          p2.then(() => {
            setStatus("tap: playing (muted)");
            setPaused(false);
          }).catch((e2: unknown) => setStatus(`tap: BLOCKED ${name} / ${(e2 as Error)?.name ?? "?"}`));
        } else {
          setStatus(`tap: rejected ${name}, no retry promise`);
        }
      });
    } else {
      setStatus("tap: play() returned undefined");
      setPaused(false);
    }
  };
  // Prefer the per-variant playable video (a real uploaded master), else the global scene clip, else the
  // gradient poster. So a variant uploaded in the Studio actually plays here.
  const url = isPlayableVideoUrl(playbackUrl) ? playbackUrl : sceneVideoUrl();

  // Attach the source through hls.js for an encoded master.m3u8 (or native src for a plain clip), and play.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !url) return;
    let alive = true;
    let cleanup = () => {};
    // CRITICAL: set the muted PROPERTY imperatively. React's `muted` JSX attribute does not reliably set the
    // DOM property, so the browser sees an unmuted autoplay and BLOCKS it (the black-frame cause). Setting it
    // here makes muted autoplay allowed; the viewer taps for sound.
    el.muted = !soundOnRef.current;
    // attachHls owns starting playback (on MANIFEST_PARSED) and logs any error; do not race it with our own
    // play() here. A rejection (e.g. hls.js import failure) is logged, not swallowed.
    setStatus("loading");
    attachHls(el, url, (s) => setStatus(s))
      .then((c) => {
        if (!alive) {
          c();
          return;
        }
        cleanup = c;
        // Carry the viewer's sound choice across cut switches.
        if (soundOnRef.current && el) el.muted = false;
      })
      .catch((err) => {
        setStatus(`attach-failed: ${err instanceof Error ? err.message : "unknown"}`);
        console.error("[player] attachHls failed", err, url);
      });
    return () => {
      alive = false;
      cleanup();
    };
  }, [url]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    // New cut on the same clip: restart from the top so each cut reads as its own scene.
    el.currentTime = 0;
    el.play()?.catch?.(() => {});
  }, [variantId]);

  // Drive the caption / AD / sign clock from the video element.
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !onTimeMs) return;
    const tick = () => onTimeMs(el.currentTime * 1000);
    el.addEventListener("timeupdate", tick);
    return () => el.removeEventListener("timeupdate", tick);
  }, [onTimeMs, url]);

  // Expose seek/toggle so the timeline scrubber can control the video (go back).
  useEffect(() => {
    if (!controlsRef) return;
    controlsRef.current = {
      seek: (ms: number) => {
        const el = videoRef.current;
        if (el && Number.isFinite(ms)) el.currentTime = Math.max(0, ms / 1000);
      },
      toggle: () => {
        const el = videoRef.current;
        if (!el) return;
        if (el.paused) {
          el.muted = false;
          el.play()?.catch?.(() => {});
        } else {
          el.pause();
        }
      },
    };
    return () => {
      if (controlsRef) controlsRef.current = null;
    };
  }, [controlsRef, url]);


  if (url) {
    return (
      <div
        className={`poster ${posterClass}`}
        data-testid="poster"
        data-scene-video="true"
        onClick={tapToPlay}
        style={{ cursor: "pointer" }}
      >
        <video
          ref={videoRef}
          muted
          autoPlay
          loop
          playsInline
          // React video events are more reliable than addEventListener for tracking real play state, so the
          // "Tap to play" overlay always reflects whether the frame is actually playing.
          onPlaying={() => {
            setPaused(false);
            onPlayingChange?.(true);
          }}
          onPlay={() => {
            setPaused(false);
            onPlayingChange?.(true);
          }}
          onPause={() => {
            setPaused(true);
            onPlayingChange?.(false);
          }}
          onWaiting={() => setPaused(true)}
          onEnded={() => {
            setPaused(true);
            onPlayingChange?.(false);
          }}
          onLoadedMetadata={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) onDurationMs?.(d * 1000);
          }}
          onDurationChange={(e) => {
            const d = e.currentTarget.duration;
            if (Number.isFinite(d)) onDurationMs?.(d * 1000);
          }}
          // Keep the gradient as the poster fallback before the clip paints.
          poster=""
          data-playback-url={playbackUrl ?? ""}
          data-src={url}
          data-fit={fit}
          style={{ objectFit: fit }}
        />
        {/* On-screen playback diagnostic: read this back if the frame is black. */}
        <div
          data-testid="player-debug"
          style={{
            position: "absolute",
            top: 28,
            left: 8,
            right: 8,
            zIndex: 9,
            textAlign: "center",
            color: "#fff",
            fontSize: 10,
            fontFamily: "monospace",
            background: "rgba(0,0,0,0.5)",
            borderRadius: 6,
            padding: "3px 6px",
            pointerEvents: "none",
            wordBreak: "break-all",
          }}
        >
          {status} · {(url ?? "").split("/media/")[1] ?? url}
        </div>
        {/* Blocked autoplay / paused: a clear, full-surface "Tap to play" so the screen is never a blank black
            frame that looks broken. A user tap is a guaranteed gesture, so playback always starts. */}
        {paused && (
          <button
            type="button"
            data-testid="tap-to-play"
            onClick={tapToPlay}
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 10,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              background: "rgba(0,0,0,0.42)",
              border: "none",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            <span
              style={{
                width: 66,
                height: 66,
                borderRadius: 999,
                background: "rgba(255,255,255,0.16)",
                border: "2px solid #fff",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 26,
                paddingLeft: 4,
              }}
              aria-hidden="true"
            >
              ▶
            </span>
            <span style={{ fontSize: 15, fontWeight: 700 }}>Tap to play</span>
            <span style={{ fontSize: 10, opacity: 0.7, fontFamily: "monospace" }}>{status}</span>
          </button>
        )}
        {/* Playing but muted: a small affordance to enable sound. */}
        {!paused && !soundOn && (
          <button
            type="button"
            data-testid="enable-sound"
            onClick={tapToPlay}
            style={{
              position: "absolute",
              bottom: "16vh",
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 8,
              background: "rgba(0,0,0,0.62)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,0.32)",
              borderRadius: 999,
              padding: "9px 18px",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Tap for sound
          </button>
        )}
      </div>
    );
  }

  // No playable media for this cut: show an explicit reason instead of a silent navy frame. A placeholder cut
  // (a seed cdn.example URL, or a beat with no uploaded variant) lands here.
  return (
    <div
      className={`poster ${posterClass}`}
      data-testid="poster"
      data-playback-url={playbackUrl ?? ""}
    >
      <div
        data-testid="no-media"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "0 12vw",
          color: "rgba(255,255,255,0.82)",
          gap: 6,
        }}
      >
        <strong style={{ fontSize: 15 }}>No video for this cut yet</strong>
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          This beat has no uploaded, encoded variant. Upload one in the Studio to play it here.
        </span>
      </div>
    </div>
  );
}
