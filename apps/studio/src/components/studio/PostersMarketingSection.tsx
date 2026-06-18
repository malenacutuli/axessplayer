// SECTION 7 - POSTERS & MARKETING (/studio/posters). One-click poster generation that CALLS the existing
// content endpoint POST /series/:id/poster/generate (the studio never holds the generation key; the content
// service runs stability-ai server-side, uploads to public storage, and persists series.poster_url with
// C2PA + Article 50 provenance). On top of that single endpoint this section composes:
//   - a STYLE picker + the generated poster_url with its provenance label,
//   - A/B poster VARIANTS (generate two candidates, mark a winner),
//   - LANGUAGE-specific posters (locale-prefixed prompt),
//   - CHANNEL creatives: banners / app thumbnails / social teaser covers (aspect-targeted prompts),
//   - a "push winner to UA testing" affordance (the experiment bandit) as a RBAC/coming-soon seam since the
//     experiment service is not wired here (no fabricated success),
//   - auto-generate marketing CREATIVES (hook clips, caption variants) behind a visible COST GATE.
// Every generated asset is AI-generated, so it carries the C2PA + Article 50 disclosure. The catalog routes
// for the bandit are not deployed in every environment: that affordance degrades to a clearly-labelled
// coming-soon seam, never a dead end. Built on @axessplayer/ui (STUDIO skin). WCAG 2.2 AA. No em dashes.
import { useCallback, useMemo, useState } from "react";
import { Button } from "@axessplayer/ui";
import { SeriesPicker } from "./SeriesPicker.js";
import { ProvenanceLabel } from "./ProvenanceLabel.js";
import { useFlatGraph } from "../../api/useFlatGraph.js";
import { useContentClient } from "../../api/useContentClient.js";
import { ContentApiError } from "../../api/client.js";
import { POSTER_STYLES, type PosterStyle } from "../../api/poster.js";

// The creative FORMATS this section can ask the poster pipeline to render. Each maps to an aspect hint that
// is folded into the prompt. The pipeline persists series.poster_url only for the "poster" format; the other
// formats are derived art the creator downloads / reuses (the content service does not yet persist them, so
// we show the generated URL and label it, but do not claim it was saved as the canonical poster).
type CreativeFormat = "poster" | "banner" | "thumbnail" | "social";

const FORMAT_META: Record<CreativeFormat, { label: string; aspect: string; blurb: string }> = {
  poster: { label: "Series poster", aspect: "9:16", blurb: "The canonical vertical title poster, saved on the series." },
  banner: { label: "Channel banner", aspect: "16:9", blurb: "Wide banner for the channel page header." },
  thumbnail: { label: "App thumbnail", aspect: "1:1", blurb: "Square thumbnail for app tiles and grids." },
  social: { label: "Social teaser cover", aspect: "4:5", blurb: "Portrait teaser cover for social feeds." },
};

const LANGS = [
  { id: "none", label: "No localized copy" },
  { id: "en", label: "English" },
  { id: "es", label: "Espanol" },
  { id: "ar", label: "Arabic" },
  { id: "de", label: "Deutsch" },
  { id: "fr", label: "Francais" },
  { id: "pt", label: "Portugues" },
] as const;

// A generated candidate the creator can compare in the A/B grid.
interface Candidate {
  id: string;
  url: string;
  style: string;
  format: CreativeFormat;
  lang: string;
  saved: boolean; // true when this URL was persisted as the series poster
}

// Display-only USD estimates for the cost-gated marketing creatives action. Mirrors the factory cost model
// spirit; the authoritative number would come from the server on commit.
const CREATIVE_COST = { hookClip: 0.45, captionSet: 0.04 };

export function PostersMarketingSection(): JSX.Element {
  const content = useContentClient();
  const [seriesId, setSeriesId] = useState("");
  const [reload, setReload] = useState(0);
  const graphState = useFlatGraph(seriesId, reload);
  const graph = graphState.status === "loaded" ? graphState.graph : null;

  const [style, setStyle] = useState<PosterStyle>(POSTER_STYLES[0]);
  const [format, setFormat] = useState<CreativeFormat>("poster");
  const [lang, setLang] = useState<string>("none");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [winnerId, setWinnerId] = useState<string | null>(null);

  const langLabel = useCallback((id: string) => LANGS.find((l) => l.id === id)?.label ?? id, []);

  // Compose the prompt the content endpoint will render. The poster format persists; other formats are
  // derived creatives. We never put the generation key in the browser; the content service holds it.
  const buildPrompt = useCallback(
    (f: CreativeFormat, s: PosterStyle, l: string): string => {
      const title = graph?.seriesTitle ?? "Series";
      const meta = FORMAT_META[f];
      const localized = l !== "none" ? ` Localized headline copy in ${langLabel(l)}.` : " No text.";
      return `${title}. ${s.prompt}. ${meta.label}, ${meta.aspect} aspect.${localized}`;
    },
    [graph, langLabel],
  );

  const onGenerate = useCallback(async () => {
    if (!graph) return;
    setBusy(true);
    setError(null);
    try {
      const prompt = buildPrompt(format, style, lang);
      const res = await content.generateSeriesPoster(graph.seriesId, prompt);
      // The poster format persists series.poster_url; other formats are derived art (same endpoint, the
      // returned URL is the rendered asset). We flag whether it was saved as the canonical poster.
      const saved = format === "poster";
      setCandidates((prev) => [
        { id: res.id || crypto.randomUUID(), url: res.poster_url, style: style.id, format, lang, saved },
        ...prev,
      ].slice(0, 6));
      // The poster format persists series.poster_url server-side; reload the graph so the current-poster
      // card reflects it.
      if (saved) setReload((n) => n + 1);
    } catch (err) {
      setError(
        err instanceof ContentApiError
          ? err.status === 501
            ? "Generation is not configured on the server (STABILITY_AI_API_KEY)."
            : err.status === 404
              ? "The content service is not reachable in this environment yet."
              : err.apiError ?? `error_${err.status}`
          : err instanceof Error
            ? err.message
            : "generation_failed",
      );
    } finally {
      setBusy(false);
    }
  }, [graph, buildPrompt, format, style, lang, content]);

  return (
    <div className="spanel" data-testid="panel-posters">
      <div className="sbar">
        <div>
          <div className="ey rose">Posters and marketing</div>
          <h2 style={{ marginTop: 8 }}>One-click poster and creative generation</h2>
          <p className="muted">Generate posters, A/B variants, localized art, channel creatives, and marketing clips.</p>
        </div>
        <ProvenanceLabel mode="generated" testId="posters-provenance" />
      </div>

      <SeriesPicker selectedId={seriesId} onSelect={setSeriesId} label="Generate art for which series" />

      {seriesId && graphState.status === "loading" && (
        <p className="muted" data-testid="posters-graph-loading">Loading the series...</p>
      )}
      {seriesId && graphState.status === "error" && (
        <p className="statusline err" role="alert" data-testid="posters-graph-error">
          Could not load the series: {graphState.message}
        </p>
      )}

      {graph && (
        <>
          {/* Current persisted poster, if any. */}
          {graph.posterUrl ? (
            <div className="inspcard" data-testid="posters-current" style={{ marginTop: 12 }}>
              <div className="scaption">Current series poster</div>
              <img
                src={graph.posterUrl}
                alt={`${graph.seriesTitle} poster`}
                className="poster-thumb"
                data-testid="posters-current-img"
                data-poster-url={graph.posterUrl}
              />
              <ProvenanceLabel mode="generated" testId="posters-current-prov" />
            </div>
          ) : (
            <p className="muted" data-testid="posters-no-current" style={{ marginTop: 10 }}>
              No poster set yet. Generate one below.
            </p>
          )}

          {/* Generation controls: style + format + language. */}
          <div className="fldgrid" style={{ marginTop: 12 }}>
            <div className="fld">
              <label htmlFor="posters-style">Style</label>
              <select
                id="posters-style"
                value={style.id}
                onChange={(e) => setStyle(POSTER_STYLES.find((s) => s.id === e.target.value) ?? POSTER_STYLES[0])}
                data-testid="posters-style"
              >
                {POSTER_STYLES.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
            </div>
            <div className="fld">
              <label htmlFor="posters-format">Format</label>
              <select
                id="posters-format"
                value={format}
                onChange={(e) => setFormat(e.target.value as CreativeFormat)}
                data-testid="posters-format"
              >
                {(Object.keys(FORMAT_META) as CreativeFormat[]).map((f) => (
                  <option key={f} value={f}>{FORMAT_META[f].label} ({FORMAT_META[f].aspect})</option>
                ))}
              </select>
            </div>
            <div className="fld">
              <label htmlFor="posters-lang">Language copy</label>
              <select
                id="posters-lang"
                value={lang}
                onChange={(e) => setLang(e.target.value)}
                data-testid="posters-lang"
              >
                {LANGS.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="muted" data-testid="posters-format-blurb" style={{ marginTop: 4 }}>
            {FORMAT_META[format].blurb}
          </p>

          <div className="btnrow" style={{ marginTop: 12 }}>
            <Button onClick={() => void onGenerate()} disabled={busy} data-testid="posters-generate">
              {busy ? "Generating..." : "Generate"}
            </Button>
            <Button
              variant="secondary"
              onClick={() => void onGenerate()}
              disabled={busy}
              data-testid="posters-generate-variant"
            >
              Generate A/B variant
            </Button>
          </div>

          {error && (
            <p className="statusline err" role="alert" data-testid="posters-error" style={{ marginTop: 10 }}>
              {error}
            </p>
          )}

          {/* A/B candidate grid: compare variants, mark a winner, push the winner to UA testing. */}
          {candidates.length > 0 && (
            <section aria-label="Generated candidates" data-testid="posters-candidates" style={{ marginTop: 14 }}>
              <div className="scaption">Candidates (A/B) - mark a winner</div>
              <ul className="poster-grid" data-testid="posters-grid">
                {candidates.map((c) => (
                  <li
                    key={c.id}
                    className={c.id === winnerId ? "poster-card on" : "poster-card"}
                    data-testid={`posters-candidate-${c.id}`}
                  >
                    <img src={c.url} alt={`${FORMAT_META[c.format].label} candidate`} className="poster-thumb" data-poster-url={c.url} />
                    <div className="poster-card__meta">
                      <span className="muted">{FORMAT_META[c.format].label} - {c.style}{c.lang !== "none" ? ` - ${langLabel(c.lang)}` : ""}</span>
                      {c.saved && <span className="tag-saved" data-testid="posters-saved-tag">Saved as poster</span>}
                    </div>
                    <ProvenanceLabel mode="generated" testId={`posters-candidate-prov-${c.id}`} />
                    <Button
                      variant={c.id === winnerId ? "primary" : "secondary"}
                      onClick={() => setWinnerId(c.id)}
                      aria-pressed={c.id === winnerId}
                      data-testid={`posters-mark-winner-${c.id}`}
                    >
                      {c.id === winnerId ? "Winner" : "Mark winner"}
                    </Button>
                  </li>
                ))}
              </ul>
              <PushToUaTesting winnerId={winnerId} />
            </section>
          )}

          {/* Auto-generate marketing creatives (hook clips, caption variants), cost-gated. */}
          <MarketingCreatives seriesTitle={graph.seriesTitle} />

          <div className="note">
            <span className="notetag">REUSE</span>
            Every asset is generated server-side by the existing content poster pipeline (the studio never
            holds the key), uploaded to public storage, and C2PA-signed and Article 50 labelled because it is
            AI-generated.
          </div>
        </>
      )}
    </div>
  );
}

// "Push winner to UA testing": the experiment bandit. The experiment service is not wired into the studio
// here, so this is a clearly-labelled coming-soon seam, never a fabricated success. It is gated until a
// winner is chosen.
function PushToUaTesting({ winnerId }: { winnerId: string | null }): JSX.Element {
  const [acked, setAcked] = useState(false);
  return (
    <div className="inspcard" data-testid="posters-ua" style={{ marginTop: 12 }}>
      <div className="scaption">Push winner to UA testing</div>
      <p className="muted">
        Send the winning creative to the user-acquisition experiment bandit to split-test it against the
        current art. The experiment service is not connected here yet.
      </p>
      <div className="btnrow" style={{ marginTop: 8 }}>
        <Button
          variant="secondary"
          disabled={!winnerId}
          onClick={() => setAcked(true)}
          data-testid="posters-push-ua"
        >
          {winnerId ? "Push winner to UA testing" : "Mark a winner first"}
        </Button>
      </div>
      {acked && (
        <p className="statusline" role="status" data-testid="posters-ua-comingsoon" style={{ marginTop: 8 }}>
          Coming soon: the experiment bandit is not wired in this environment. Nothing was pushed.
        </p>
      )}
    </div>
  );
}

// Auto-generate marketing creatives (hook clips + caption variants) behind a visible cost gate. The clip
// pipeline is not wired here; this is a cost-gated coming-soon seam that never fakes a render.
function MarketingCreatives({ seriesTitle }: { seriesTitle: string }): JSX.Element {
  const [hookClips, setHookClips] = useState(2);
  const [captionSets, setCaptionSets] = useState(3);
  const [confirmed, setConfirmed] = useState(false);
  const [ran, setRan] = useState(false);

  const total = useMemo(
    () => hookClips * CREATIVE_COST.hookClip + captionSets * CREATIVE_COST.captionSet,
    [hookClips, captionSets],
  );

  return (
    <div className="inspcard" data-testid="posters-creatives" style={{ marginTop: 12 }}>
      <div className="scaption">Auto-generate marketing creatives - {seriesTitle}</div>
      <p className="muted">Hook clips and caption variants for paid and organic distribution.</p>
      <div className="fldgrid" style={{ marginTop: 8 }}>
        <div className="fld">
          <label htmlFor="creatives-hooks">Hook clips</label>
          <input
            id="creatives-hooks"
            type="number"
            min={0}
            max={10}
            value={hookClips}
            onChange={(e) => { setHookClips(Math.max(0, Number.parseInt(e.target.value, 10) || 0)); setConfirmed(false); }}
            data-testid="creatives-hooks"
          />
        </div>
        <div className="fld">
          <label htmlFor="creatives-captions">Caption variant sets</label>
          <input
            id="creatives-captions"
            type="number"
            min={0}
            max={20}
            value={captionSets}
            onChange={(e) => { setCaptionSets(Math.max(0, Number.parseInt(e.target.value, 10) || 0)); setConfirmed(false); }}
            data-testid="creatives-captions"
          />
        </div>
      </div>
      <div className="kv" style={{ display: "flex", justifyContent: "space-between", padding: "6px 0 0", fontWeight: 700 }}>
        <span>Estimated, under the cost gate</span>
        <b data-testid="creatives-cost">${total.toFixed(2)}</b>
      </div>
      <div className="btnrow" style={{ marginTop: 8 }}>
        {!confirmed ? (
          <Button
            variant="secondary"
            disabled={total <= 0}
            onClick={() => setConfirmed(true)}
            data-testid="creatives-confirm"
          >
            Confirm ${total.toFixed(2)} estimate
          </Button>
        ) : (
          <>
            <Button onClick={() => setRan(true)} data-testid="creatives-run">Generate creatives</Button>
            <Button variant="secondary" onClick={() => setConfirmed(false)} data-testid="creatives-cancel">Back</Button>
          </>
        )}
      </div>
      {ran && (
        <p className="statusline" role="status" data-testid="creatives-comingsoon" style={{ marginTop: 8 }}>
          Coming soon: the marketing-clip pipeline is not connected in this environment. No spend occurred.
        </p>
      )}
    </div>
  );
}
