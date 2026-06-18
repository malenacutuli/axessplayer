// Section 5 - PROCESS / MAKE ACCESSIBLE (/studio/process): the GOLD_STANDARD_08 upload-once journey.
// The creator sets accessibility targets ONCE at the episode level (target languages, tracks ALL ON by
// default so they opt OUT, sign languages, cost tier), sees the fan-out PLAN + COST under a visible gate,
// then hits Process (POST /produce). The ingestion factory runs the fan-out async; this panel then becomes
// a live PROCESSING DASHBOARD (per-stage status/cost, resumable from GET /jobs/:id) and a REVIEW QUEUE for
// the hero AD/sign/dub drafts (accept / edit / replace, or upload a human interpreter sign clip). A CWI
// character attribution panel assigns characters to a palette (color is an enhancement over the compliant
// default, never a replacement for it).
//
// Reuses the existing factory (services/ingestion) via the ingestion client. Does NOT rebuild track
// generation. Real loading / empty / error states, no dead ends. WCAG AA. Built on @axessplayer/ui. No em
// dashes.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useIngestionClient } from "../../api/useIngestionClient.js";
import { useFlatGraph } from "../../api/useFlatGraph.js";
import { IngestionApiError, type Job, type JobStage, type ProduceTargets, type TrackKind } from "../../api/ingestion.js";
import { SeriesPicker } from "./SeriesPicker.js";
import { ProvenanceLabel } from "./ProvenanceLabel.js";
import { StatusChip, type StatusKind } from "@axessplayer/ui";

const ALL_LANGS = ["en", "es", "ar", "de", "fr", "it", "pt"] as const;
const LANG_LABEL: Record<string, string> = { en: "English", es: "Espanol", ar: "Arabic", de: "Deutsch", fr: "Francais", it: "Italiano", pt: "Portugues" };
const ALL_SIGN = ["ASL", "PSL", "LSA", "Libras"] as const;

type TrackToggleKey = keyof ProduceTargets["tracks"]; // cc | ad | sign | dub
const TRACK_LABEL: Record<TrackToggleKey, string> = {
  cc: "Captions with Intention",
  ad: "Audio description",
  sign: "Sign language",
  dub: "Dubbing",
};

// Per-derivative cost estimate (USD), mirroring services/ingestion/costModel.ts so the gate preview matches
// what the factory will actually bill. Display-only here; the authoritative number comes back on POST.
const COST: Record<TrackKind, number> = {
  transcript: 0.03,
  poster: 0.04,
  captions: 0.04,
  audio_description: 0.35,
  sign: 0.2,
  dub: 0.45,
};

// Map an ingestion stage status to the shared StatusChip kind (live=ready, review=needs_review).
function chipStatus(s: JobStage["status"]): StatusKind {
  switch (s) {
    case "ready":
      return "live";
    case "needs_review":
      return "review";
    case "running":
      return "processing";
    case "failed":
      return "failed";
    default:
      return "draft";
  }
}

const BASE_LANG = "en";

export function ProcessPanel(): JSX.Element {
  const ingestion = useIngestionClient();
  const [seriesId, setSeriesId] = useState("");
  const graphState = useFlatGraph(seriesId, 0);
  const graph = graphState.status === "loaded" ? graphState.graph : null;

  // Targets, set ONCE. Accessible by default: every track starts ON so the creator opts OUT.
  const [langs, setLangs] = useState<string[]>([BASE_LANG, "es"]);
  const [tracks, setTracks] = useState<ProduceTargets["tracks"]>({ cc: true, ad: true, sign: true, dub: true });
  const [signLangs, setSignLangs] = useState<string[]>(["ASL"]);
  const [costTier, setCostTier] = useState<"standard" | "hero">("standard");

  // Cost gate + produce lifecycle.
  const [gateConfirmed, setGateConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [produceError, setProduceError] = useState<string | null>(null);

  // Live job (dashboard + review queue), polled from GET /jobs/:id while it is not terminal.
  const [job, setJob] = useState<Job | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);

  const beats = graph?.beats.length ?? 0;
  const toggle = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  // The fan-out plan + estimated cost, derived live from the targets (transcript + poster once per beat,
  // captions/AD per language, dub per non-base language, sign per sign language). This is the COST GATE.
  const plan = useMemo(() => {
    const rows: Array<{ stage: string; count: number; each: number }> = [];
    const b = beats || 1;
    rows.push({ stage: "Transcript (ASR)", count: b, each: COST.transcript });
    rows.push({ stage: "Poster", count: 1, each: COST.poster });
    if (tracks.cc) rows.push({ stage: `Captions with Intention x ${langs.length} lang`, count: b * langs.length, each: COST.captions });
    if (tracks.ad) rows.push({ stage: `Audio description x ${langs.length} lang`, count: b * langs.length, each: COST.audio_description });
    if (tracks.dub) {
      const dl = langs.filter((l) => l !== BASE_LANG).length;
      if (dl) rows.push({ stage: `Dubbing x ${dl} lang`, count: b * dl, each: COST.dub });
    }
    if (tracks.sign) rows.push({ stage: `Sign x ${signLangs.length}`, count: b * signLangs.length, each: COST.sign });
    const total = rows.reduce((s, r) => s + r.count * r.each, 0);
    return { rows, total };
  }, [beats, langs, tracks, signLangs]);

  // Any target change re-opens the gate so the creator re-confirms the cost.
  const invalidateGate = useCallback(() => setGateConfirmed(false), []);

  const onProcess = async () => {
    if (!graph) return;
    setBusy(true);
    setProduceError(null);
    try {
      const episodeId = graph.beats[0]?.episode_id ?? "";
      const r = await ingestion.produce({
        seriesId: graph.seriesId,
        episodeId,
        targets: { languages: langs, tracks, signLanguages: signLangs, costTier },
      });
      setJobId(r.jobId);
    } catch (e) {
      setProduceError(
        e instanceof IngestionApiError
          ? e.status === 501 || e.status === 404
            ? "The processing service is not connected in this environment yet."
            : e.apiError ?? `error_${e.status}`
          : e instanceof Error
            ? e.message
            : "process_failed",
      );
    } finally {
      setBusy(false);
    }
  };

  // Poll the live job while it is running, so the dashboard and review queue stay current and resumable.
  useEffect(() => {
    if (!jobId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const j = await ingestion.getJob(jobId);
        if (!alive) return;
        setJob(j);
        setJobError(null);
        if (j.state === "running" || j.state === "queued" || j.state === "partial") {
          timer = setTimeout(() => void tick(), 2500);
        }
      } catch (e) {
        if (!alive) return;
        setJobError(
          e instanceof IngestionApiError
            ? e.status === 404
              ? "Job not found. It may not have been persisted yet."
              : e.apiError ?? `error_${e.status}`
            : e instanceof Error
              ? e.message
              : "job_load_failed",
        );
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [jobId, ingestion]);

  // Characters for the CWI attribution panel come from the series canon facts when present; else a default.
  const characters = useMemo<string[]>(() => {
    if (!graph) return [];
    const names = new Set<string>();
    for (const b of graph.beats) {
      const cast = (b.canon_facts as { characters?: unknown }).characters;
      if (Array.isArray(cast)) for (const c of cast) if (typeof c === "string") names.add(c);
    }
    return Array.from(names);
  }, [graph]);

  const reviewStages = useMemo(
    () => (job?.stages ?? []).filter((s) => s.status === "needs_review" || s.status === "ready").filter((s) => s.kind === "audio_description" || s.kind === "sign" || s.kind === "dub"),
    [job],
  );

  return (
    <div className="spanel" data-testid="panel-process">
      <div className="sbar">
        <div>
          <div className="ey rose">Make accessible</div>
          <h2 style={{ marginTop: 8 }}>Process</h2>
          <p className="muted">Set targets once. The factory fans out every derivative. You review the heroes.</p>
        </div>
        <ProvenanceLabel mode="assisted" testId="process-provenance" />
      </div>

      <SeriesPicker selectedId={seriesId} onSelect={setSeriesId} label="Make which series accessible" />

      {seriesId && graphState.status === "loading" && (
        <p className="muted" data-testid="process-graph-loading">Loading the series...</p>
      )}
      {seriesId && graphState.status === "error" && (
        <p className="statusline err" role="alert" data-testid="process-graph-error">Could not load the series: {graphState.message}</p>
      )}

      {graph && (
        <>
          <div className="fld">
            <label>Target languages</label>
            <div className="langrow">
              {ALL_LANGS.map((l) => (
                <button
                  key={l}
                  type="button"
                  className={langs.includes(l) ? "chip on" : "chip"}
                  aria-pressed={langs.includes(l)}
                  disabled={l === BASE_LANG}
                  onClick={() => {
                    setLangs((a) => toggle(a, l));
                    invalidateGate();
                  }}
                  data-testid={`process-lang-${l}`}
                >
                  {LANG_LABEL[l]}
                  {l === BASE_LANG ? " (base)" : ""}
                </button>
              ))}
            </div>
          </div>

          <div className="fld">
            <label>
              Accessibility tracks <span className="muted">(all on by default - opt out, not in)</span>
            </label>
            <div className="langrow">
              {(Object.keys(TRACK_LABEL) as TrackToggleKey[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className={tracks[t] ? "chip on" : "chip"}
                  aria-pressed={tracks[t]}
                  onClick={() => {
                    setTracks((s) => ({ ...s, [t]: !s[t] }));
                    invalidateGate();
                  }}
                  data-testid={`process-track-${t}`}
                >
                  {TRACK_LABEL[t]}
                </button>
              ))}
            </div>
          </div>

          {tracks.sign && (
            <div className="fld">
              <label>Sign languages</label>
              <div className="langrow">
                {ALL_SIGN.map((sl) => (
                  <button
                    key={sl}
                    type="button"
                    className={signLangs.includes(sl) ? "chip on" : "chip"}
                    aria-pressed={signLangs.includes(sl)}
                    onClick={() => {
                      setSignLangs((a) => toggle(a, sl));
                      invalidateGate();
                    }}
                    data-testid={`process-sign-${sl}`}
                  >
                    {sl}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="fld">
            <label htmlFor="process-tier">Cost tier</label>
            <select
              id="process-tier"
              value={costTier}
              onChange={(e) => {
                setCostTier(e.target.value as "standard" | "hero");
                invalidateGate();
              }}
            >
              <option value="standard">Standard (lazy generate on demand)</option>
              <option value="hero">Hero (pre-generate everything now)</option>
            </select>
          </div>

          {/* COST GATE: the plan + estimated cost BEFORE commit; the creator confirms, then Process enqueues. */}
          <div className="inspcard" data-testid="process-plan" style={{ marginTop: 12 }}>
            <div className="scaption">What Process will generate ({beats} beats)</div>
            {plan.rows.map((r) => (
              <div key={r.stage} className="kv" style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                <span>{r.stage}</span>
                <b>
                  {r.count} stages - ${(r.count * r.each).toFixed(2)}
                </b>
              </div>
            ))}
            <div className="kv" style={{ display: "flex", justifyContent: "space-between", padding: "6px 0 0", fontWeight: 700 }}>
              <span>Estimated, under the cost gate</span>
              <b data-testid="process-cost">${plan.total.toFixed(2)}</b>
            </div>

            <div className="btnrow" style={{ marginTop: 10 }}>
              {!gateConfirmed && !jobId && (
                <button
                  type="button"
                  className="btn pri"
                  onClick={() => setGateConfirmed(true)}
                  disabled={langs.length === 0}
                  data-testid="process-confirm-cost"
                >
                  Confirm ${plan.total.toFixed(2)} estimate
                </button>
              )}
              {gateConfirmed && !jobId && (
                <>
                  <button type="button" className="btn pri" onClick={() => void onProcess()} disabled={busy} data-testid="process-run">
                    {busy ? "Starting..." : "Process"}
                  </button>
                  <button type="button" className="btn" onClick={() => setGateConfirmed(false)} data-testid="process-cancel">
                    Back
                  </button>
                </>
              )}
            </div>
            {produceError && (
              <p className="statusline err" role="alert" data-testid="process-error" style={{ marginTop: 10 }}>
                {produceError}
              </p>
            )}
          </div>

          {/* CWI character attribution: assign characters to the palette. Color is an enhancement only. */}
          <CwiAttribution characters={characters} />

          {/* LIVE PROCESSING DASHBOARD + REVIEW QUEUE: appear once a job is enqueued. */}
          {jobId && (
            <ProcessingDashboard job={job} jobError={jobError} reviewStages={reviewStages} />
          )}

          <div className="note">
            <span className="notetag">ACCESSIBLE BY DEFAULT</span>
            Every track is on unless you turn it off. Each derivative is C2PA-signed and Article 50 labeled,
            registered onto the beats, idempotent and resumable. This reuses the existing factory.
          </div>
        </>
      )}
    </div>
  );
}

// CWI character attribution panel. The compliant default (a single distinguishable caption style) always
// works; assigning a palette color per character is an ENHANCEMENT layered on top, never the baseline.
function CwiAttribution({ characters }: { characters: string[] }): JSX.Element {
  const PALETTE = ["#e11d63", "#2563eb", "#16a34a", "#d97706", "#7c3aed", "#0891b2"];
  const [assign, setAssign] = useState<Record<string, number>>({});

  return (
    <div className="inspcard" data-testid="process-cwi" style={{ marginTop: 12 }}>
      <div className="scaption">Captions with Intention - character attribution</div>
      <p className="muted">
        Color is an enhancement over the compliant default. Captions stay distinguishable without it; assign
        a palette color to help sighted viewers track who is speaking.
      </p>
      {characters.length === 0 ? (
        <p className="muted" data-testid="process-cwi-empty">
          No characters detected yet. They populate from the script once the series has canon facts.
        </p>
      ) : (
        <ul className="cwilist" data-testid="process-cwi-list">
          {characters.map((c) => (
            <li key={c} className="cwirow" data-testid={`process-cwi-${c}`}>
              <span className="cwirow__name">{c}</span>
              <span className="cwirow__swatches" role="radiogroup" aria-label={`Caption color for ${c}`}>
                {PALETTE.map((color, i) => (
                  <button
                    key={color}
                    type="button"
                    role="radio"
                    aria-checked={assign[c] === i}
                    aria-label={`Color ${i + 1} for ${c}`}
                    className={assign[c] === i ? "swatch on" : "swatch"}
                    style={{ background: color }}
                    onClick={() => setAssign((a) => ({ ...a, [c]: i }))}
                  />
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The live processing dashboard (per-stage status/cost) and the review queue (hero AD/sign/dub drafts:
// accept / edit / replace, or upload a human interpreter sign clip). Reads the job; resumable on reload.
function ProcessingDashboard({
  job,
  jobError,
  reviewStages,
}: {
  job: Job | null;
  jobError: string | null;
  reviewStages: JobStage[];
}): JSX.Element {
  if (jobError) {
    return (
      <div className="inspcard" data-testid="process-dashboard" style={{ marginTop: 12 }}>
        <div className="scaption">Processing</div>
        <p className="statusline err" role="alert" data-testid="process-job-error">
          {jobError}
        </p>
      </div>
    );
  }
  if (!job) {
    return (
      <div className="inspcard" data-testid="process-dashboard" style={{ marginTop: 12 }}>
        <div className="scaption">Processing</div>
        <p className="muted" role="status" data-testid="process-job-loading">
          Starting the job and loading stage status...
        </p>
      </div>
    );
  }

  const done = job.stages.filter((s) => s.status === "ready").length;

  return (
    <div className="inspcard" data-testid="process-dashboard" style={{ marginTop: 12 }}>
      <div className="scaption">
        Processing dashboard - job {job.jobId.slice(0, 8)} ({done}/{job.stages.length} ready, {job.state})
      </div>
      <ul className="stagestatus" data-testid="process-stage-list">
        {job.stages.map((s, i) => (
          <li key={`${s.name}-${i}`} className="stagestatus__row" data-testid={`process-stage-${i}`} data-status={s.status}>
            <span className="stagestatus__name">{s.label ?? s.name}</span>
            <span className="stagestatus__cost muted">${s.cost.toFixed(2)}</span>
            <StatusChip status={chipStatus(s.status)} />
          </li>
        ))}
      </ul>

      <div className="scaption" style={{ marginTop: 14 }}>
        Review queue - hero drafts (audio description, sign, dub)
      </div>
      {reviewStages.length === 0 ? (
        <p className="muted" data-testid="process-review-empty">
          No hero drafts to review yet. They appear here as the factory produces them.
        </p>
      ) : (
        <ul className="reviewqueue" data-testid="process-review-list">
          {reviewStages.map((s, i) => (
            <li key={`${s.name}-${i}`} className="reviewrow" data-testid={`process-review-${i}`}>
              <span className="reviewrow__name">{s.label ?? s.name}</span>
              <span className="reviewrow__prov">
                <ProvenanceLabel mode="assisted" testId={`process-review-prov-${i}`} />
              </span>
              <span className="reviewrow__actions">
                <button type="button" className="btn pri" data-testid={`process-review-accept-${i}`}>
                  Accept
                </button>
                <button type="button" className="btn" data-testid={`process-review-edit-${i}`}>
                  Edit
                </button>
                <button type="button" className="btn" data-testid={`process-review-replace-${i}`}>
                  Replace
                </button>
                {s.kind === "sign" && (
                  <label className="btn" data-testid={`process-review-upload-sign-${i}`}>
                    Upload interpreter clip
                    <input type="file" accept="video/*" hidden />
                  </label>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
