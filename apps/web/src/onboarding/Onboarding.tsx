// 20-V1 ONBOARDING COLD OPEN (route /onboarding per INTERACTION_MAP).
//
// "No menus": a full-bleed cold open that asks three taps (pace, POV, intensity) behind a 3-step
// progress indicator, then POSTs /calibrate (which writes viewer_state.preference_vector) and shows the
// "Your cut is ready" payoff card with a CUT FOR YOU badge from @axessplayer/ui. Play episode 1 triggers
// the first /decide using the calibration (it opens the live adaptive player on the configured series).
//
// Every step emits its calibration breadcrumb so the flywheel sees the cold open even before any
// personalization model exists. Real loading + error states on the calibrate call: no dead ends.
// No em dashes.

import { useCallback, useState } from "react";
import { Button, Chip, CutForYouBadge, ErrorState } from "@axessplayer/ui";
import type { CatalogClient, CalibratePace, CalibrateResult } from "../api/catalog.js";
import type { ViewerAnalytics } from "../analytics/analytics.js";

export interface OnboardingProps {
  catalog: CatalogClient;
  analytics: ViewerAnalytics;
  seriesId: string;
  // Called when the viewer taps Play on the payoff card: opens the live adaptive player on the
  // configured series, which triggers the first /decide using the calibration just written.
  onPlay: () => void;
  // Skip the cold open and go to the home feed (the "Browse instead" escape hatch, no dead end).
  onSkip?: () => void;
}

type Step = 0 | 1 | 2;

const PACE_OPTIONS: Array<{ value: CalibratePace; label: string; hint: string }> = [
  { value: "slow_burn", label: "Slow burn", hint: "Let it breathe. Tension builds." },
  { value: "tense", label: "All tension", hint: "Hit me fast. No slack." },
];

const POV_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "protagonist", label: "The one in the room" },
  { value: "observer", label: "The one watching" },
  { value: "both", label: "Both sides" },
];

const INTENSITY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0.25, label: "Gentle" },
  { value: 0.6, label: "Balanced" },
  { value: 0.9, label: "Intense" },
];

export function Onboarding({ catalog, analytics, seriesId, onPlay, onSkip }: OnboardingProps) {
  const [step, setStep] = useState<Step>(0);
  const [pace, setPace] = useState<CalibratePace | null>(null);
  const [pov, setPov] = useState<string | null>(null);
  const [intensity, setIntensity] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CalibrateResult | null>(null);

  const submit = useCallback(
    async (finalIntensity: number) => {
      if (pace == null || pov == null) return;
      setSubmitting(true);
      setError(null);
      try {
        const res = await catalog.calibrate({ pace, pov, intensity: finalIntensity });
        setResult(res);
        // Calibration breadcrumbs: cut_switched marks the personalized assembly, pov/intensity selected
        // capture the explicit cold-open choices for the flywheel.
        analytics.track("pov_selected", { seriesId, props: { pov } });
        analytics.track("intensity_selected", { seriesId, props: { intensity: finalIntensity } });
        analytics.track("cut_switched", { seriesId, props: { pace, source: "onboarding_calibration" } });
      } catch (err) {
        setError(err instanceof Error ? err.message : "We could not tune your cut. Try again.");
      } finally {
        setSubmitting(false);
      }
    },
    [catalog, analytics, seriesId, pace, pov],
  );

  // ---- Payoff: "Your cut is ready" -----------------------------------------
  if (result) {
    return (
      <div className="scr ob ob--payoff" data-testid="onboarding-ready">
        <div className="ob__payoff">
          <CutForYouBadge>{result.badge || "CUT FOR YOU"}</CutForYouBadge>
          <h1 className="ob__title">Your cut is ready</h1>
          <p className="ob__summary" data-testid="onboarding-summary">
            {result.summary || "Slow burn, your POV, English. We tuned the pacing to you."}
          </p>
          <div className="ob__actions">
            <Button
              variant="primary"
              size="lg"
              data-testid="onboarding-play"
              onClick={() => {
                analytics.track("series_opened", { seriesId, props: { source: "onboarding_payoff" } });
                analytics.track("continue_resumed", { seriesId, props: { source: "onboarding_payoff" } });
                onPlay();
              }}
            >
              Play episode 1
            </Button>
            {onSkip && (
              <Button variant="ghost" onClick={onSkip} data-testid="onboarding-browse">
                Browse instead
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---- Question steps ------------------------------------------------------
  return (
    <div className="scr ob" data-testid="onboarding">
      <ProgressDots step={step} total={3} />

      {error && (
        <div className="ob__error">
          <ErrorState
            title="We could not tune your cut"
            action={
              <Button variant="secondary" onClick={() => void submit(intensity ?? 0.6)} disabled={submitting}>
                {submitting ? "Tuning." : "Try again"}
              </Button>
            }
          >
            {error}
          </ErrorState>
        </div>
      )}

      {step === 0 && (
        <section className="ob__step" aria-labelledby="ob-q1">
          <h1 className="ob__title" id="ob-q1">
            How should it feel?
          </h1>
          <p className="ob__sub">No menus. Just tell us the vibe and we cut the rest.</p>
          <div className="ob__choices" role="group" aria-label="Pace">
            {PACE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`ob__choice ${pace === o.value ? "is-on" : ""}`}
                aria-pressed={pace === o.value}
                data-testid={`onboarding-pace-${o.value}`}
                onClick={() => {
                  setPace(o.value);
                  setStep(1);
                }}
              >
                <span className="ob__choice-label">{o.label}</span>
                <span className="ob__choice-hint">{o.hint}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {step === 1 && (
        <section className="ob__step" aria-labelledby="ob-q2">
          <h1 className="ob__title" id="ob-q2">
            Whose eyes?
          </h1>
          <p className="ob__sub">Point of view shapes which cut you see.</p>
          <div className="ob__chips" role="group" aria-label="Point of view">
            {POV_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                active={pov === o.value}
                data-testid={`onboarding-pov-${o.value}`}
                onClick={() => {
                  setPov(o.value);
                  setStep(2);
                }}
              >
                {o.label}
              </Chip>
            ))}
          </div>
          <Button variant="ghost" onClick={() => setStep(0)} data-testid="onboarding-back-1">
            Back
          </Button>
        </section>
      )}

      {step === 2 && (
        <section className="ob__step" aria-labelledby="ob-q3">
          <h1 className="ob__title" id="ob-q3">
            How intense?
          </h1>
          <p className="ob__sub">Last tap. Then your cut assembles.</p>
          <div className="ob__chips" role="group" aria-label="Intensity">
            {INTENSITY_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                active={intensity === o.value}
                data-testid={`onboarding-intensity-${o.value}`}
                disabled={submitting}
                onClick={() => {
                  setIntensity(o.value);
                  void submit(o.value);
                }}
              >
                {o.label}
              </Chip>
            ))}
          </div>
          {submitting && (
            <p className="ob__sub" role="status" data-testid="onboarding-tuning">
              Tuning the pacing to you.
            </p>
          )}
          <Button variant="ghost" onClick={() => setStep(1)} disabled={submitting} data-testid="onboarding-back-2">
            Back
          </Button>
        </section>
      )}
    </div>
  );
}

function ProgressDots({ step, total }: { step: number; total: number }) {
  return (
    <div
      className="ob__dots"
      role="progressbar"
      aria-label="Onboarding progress"
      aria-valuenow={step + 1}
      aria-valuemin={1}
      aria-valuemax={total}
      data-testid="onboarding-progress"
    >
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`ob__dot ${i <= step ? "is-on" : ""}`} aria-hidden />
      ))}
    </div>
  );
}
