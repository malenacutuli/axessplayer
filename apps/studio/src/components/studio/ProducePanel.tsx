// Simple-mode creator journey (GOLD_STANDARD_08): set the targets ONCE at the series/episode level, then
// hit Process and the ingestion factory generates every accessibility derivative automatically. The design
// call that matters: every accessibility track defaults ON, so a creator opts OUT, never in. This panel is
// the "set up languages" moment + the Process trigger + a live stage-plan/cost preview. The async fan-out,
// the per-stage processing dashboard, and the review queue read the job the Process action starts. No em
// dashes.

import { useMemo, useState } from "react";
import type { FlatGraph } from "../../api/flattenGraph.js";
import { useContentClient } from "../../api/useContentClient.js";
import { ContentApiError } from "../../api/client.js";

export interface ProducePanelProps {
  graph: FlatGraph;
}

const ALL_LANGS = ["en", "es", "ar", "de", "fr", "it", "pt"] as const;
const LANG_LABEL: Record<string, string> = { en: "English", es: "Espanol", ar: "Arabic", de: "Deutsch", fr: "Francais", it: "Italiano", pt: "Portugues" };
const ALL_SIGN = ["ASL", "PSL", "LSA", "Libras"] as const;
type Track = "captions" | "audio_description" | "sign" | "dub";
const TRACK_LABEL: Record<Track, string> = { captions: "Captions with Intention", audio_description: "Audio description", sign: "Sign language", dub: "Dubbing" };

// Cost constants mirror services/ingestion/costModel.ts (calibrated to the real edge-function prices).
const COST = { transcript: 0.03, poster: 0.04, captions: 0.04, ad: 0.35, dub: 0.45, sign: 0.2 };

export function ProducePanel({ graph }: ProducePanelProps): JSX.Element {
  const client = useContentClient();
  const baseLang = "en";
  const [langs, setLangs] = useState<string[]>([baseLang, "es"]);
  // Accessible by default: every track starts ON. The creator opts out, never in.
  const [tracks, setTracks] = useState<Record<Track, boolean>>({ captions: true, audio_description: true, sign: true, dub: true });
  const [signLangs, setSignLangs] = useState<string[]>(["ASL"]);
  const [tier, setTier] = useState<"hero" | "standard">("standard");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const beats = graph.beats.length || 1;

  const toggle = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  // The stage plan + estimated cost, derived live from the targets (transcript + poster once per beat,
  // captions/AD per language, dub per non-base language, sign per sign language).
  const plan = useMemo(() => {
    const rows: Array<{ stage: string; count: number; each: number }> = [];
    rows.push({ stage: "Transcript (ASR)", count: beats, each: COST.transcript });
    rows.push({ stage: "Poster", count: 1, each: COST.poster });
    if (tracks.captions) rows.push({ stage: `Captions with Intention x ${langs.length} lang`, count: beats * langs.length, each: COST.captions });
    if (tracks.audio_description) rows.push({ stage: `Audio description x ${langs.length} lang`, count: beats * langs.length, each: COST.ad });
    if (tracks.dub) { const dl = langs.filter((l) => l !== baseLang).length; if (dl) rows.push({ stage: `Dubbing x ${dl} lang`, count: beats * dl, each: COST.dub }); }
    if (tracks.sign) rows.push({ stage: `Sign x ${signLangs.length}`, count: beats * signLangs.length, each: COST.sign });
    const total = rows.reduce((s, r) => s + r.count * r.each, 0);
    return { rows, total };
  }, [beats, langs, tracks, signLangs]);

  const onProcess = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await client.produceSeries(graph.seriesId, {
        languages: langs,
        tracks: (Object.keys(tracks) as Track[]).filter((t) => tracks[t]),
        signLanguages: signLangs,
        tier,
      });
      setResult(`Processing started: job ${r.jobId}, ${r.stageCount} stages, est $${r.estimatedUsd.toFixed(2)}. Watch progress in the processing view.`);
    } catch (e) {
      setError(e instanceof ContentApiError ? (e.status === 501 ? "Processing service not configured yet." : (e.apiError ?? `error_${e.status}`)) : e instanceof Error ? e.message : "process_failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="spanel" data-testid="panel-produce">
      <div className="sbar">
        <div>
          <div className="ey rose">Simple mode</div>
          <h2 style={{ marginTop: 8 }}>Produce - {graph.seriesTitle}</h2>
          <p className="muted">Set the targets once, then Process. The factory generates every derivative automatically.</p>
        </div>
        <button type="button" className="btn pri" onClick={() => void onProcess()} disabled={busy || langs.length === 0} data-testid="produce-process">
          {busy ? "Starting..." : "Process"}
        </button>
      </div>

      <div className="fld">
        <label>Target languages</label>
        <div className="langrow">
          {ALL_LANGS.map((l) => (
            <button key={l} type="button" className={langs.includes(l) ? "chip on" : "chip"} aria-pressed={langs.includes(l)}
              onClick={() => setLangs((a) => toggle(a, l))} data-testid={`produce-lang-${l}`} disabled={l === baseLang}>
              {LANG_LABEL[l]}{l === baseLang ? " (base)" : ""}
            </button>
          ))}
        </div>
      </div>

      <div className="fld">
        <label>Accessibility tracks <span className="muted">(all on by default - opt out, not in)</span></label>
        <div className="langrow">
          {(Object.keys(TRACK_LABEL) as Track[]).map((t) => (
            <button key={t} type="button" className={tracks[t] ? "chip on" : "chip"} aria-pressed={tracks[t]}
              onClick={() => setTracks((s) => ({ ...s, [t]: !s[t] }))} data-testid={`produce-track-${t}`}>
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
              <button key={sl} type="button" className={signLangs.includes(sl) ? "chip on" : "chip"} aria-pressed={signLangs.includes(sl)}
                onClick={() => setSignLangs((a) => toggle(a, sl))} data-testid={`produce-sign-${sl}`}>
                {sl}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="fld">
        <label htmlFor="produce-tier">Cost tier</label>
        <select id="produce-tier" value={tier} onChange={(e) => setTier(e.target.value as "hero" | "standard")}>
          <option value="standard">Standard (lazy generate on demand)</option>
          <option value="hero">Hero (pre-generate everything now)</option>
        </select>
      </div>

      <div className="insp" data-testid="produce-plan" style={{ marginTop: 12 }}>
        <div className="scaption">What Process will generate ({beats} beats)</div>
        {plan.rows.map((r) => (
          <div key={r.stage} className="kv" style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
            <span>{r.stage}</span>
            <b>{r.count} stages - ${(r.count * r.each).toFixed(2)}</b>
          </div>
        ))}
        <div className="kv" style={{ display: "flex", justifyContent: "space-between", padding: "6px 0 0", fontWeight: 700 }}>
          <span>Estimated, under the cost gate</span>
          <b data-testid="produce-cost">${plan.total.toFixed(2)}</b>
        </div>
      </div>

      {result && <p className="statusline" role="status" data-testid="produce-result" style={{ marginTop: 10 }}>{result}</p>}
      {error && <p className="statusline err" role="alert" data-testid="produce-error" style={{ marginTop: 10 }}>{error}</p>}

      <div className="note">
        <span className="notetag">ACCESSIBLE BY DEFAULT</span>
        Every accessibility track is on unless the creator turns it off. Each derivative is C2PA-signed and
        Article 50 labeled, registered onto the beats, idempotent and resumable. The manual per-variant Media
        screen stays as the Pro override.
      </div>
    </div>
  );
}
