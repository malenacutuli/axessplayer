// Media & variants panel: a drop zone (drag a 9:16 master, auto-encodes to HLS), the real variant list for
// the selected beat with an encode/QA status, and an inspector (Cut, Language, Accessibility chips, Tier,
// Provenance C2PA). "Upload a variant" creates a beat_variant via POST /variants with
// language/intensity/tier/is_premium/coin_cost/playback_url, then refreshes.
//
// OUT OF SCOPE (flagged): real file upload and HLS encoding are the generation pipeline. Here we accept a
// playback_url (or a placeholder) and create the row, exactly as the brief scopes it. No em dashes.
import { useState, type FormEvent } from "react";
import { useContentClient } from "../../api/useContentClient.js";
import { ContentApiError } from "../../api/client.js";
import { VARIANT_TIERS, type VariantTier } from "../../api/contractGap.js";
import type { FlatGraph, FlatBeat, FlatVariant } from "../../api/flattenGraph.js";

export interface MediaPanelProps {
  graph: FlatGraph;
  selectedBeatId: string | null;
  onSelectBeat: (beatId: string) => void;
  onCreated: () => void;
  onGoToPricing: () => void;
}

// Map intensity to a poster gradient class for the variant thumbnail, mirroring the prototype.
function thumbClass(v: FlatVariant): string {
  if (v.is_premium) return "g2";
  return v.intensity >= 4 ? "gtense" : v.intensity <= 2 ? "gcalm" : "gp";
}

function encodeLabel(v: FlatVariant): { detail: string; ready: boolean } {
  if (v.qa_status === "passed") return { detail: "encoded", ready: true };
  if (v.qa_status === "rejected") return { detail: "rejected", ready: false };
  return { detail: "encoding...", ready: false };
}

export function MediaPanel({
  graph,
  selectedBeatId,
  onSelectBeat,
  onCreated,
  onGoToPricing,
}: MediaPanelProps): JSX.Element {
  const beat: FlatBeat | undefined =
    (selectedBeatId ? graph.beatById.get(selectedBeatId) : undefined) ?? graph.beats[0];
  const beatVariants = beat ? graph.variants.filter((v) => v.beat_id === beat.id) : [];
  const beatLabel = beat
    ? `Beat - #${beat.beat_index} ${beat.is_branch_point ? "branch point" : beat.role}`
    : "No beat selected";

  return (
    <div className="spanel" data-testid="panel-media">
      <div className="sbar">
        <div>
          <div className="ey rose">{beatLabel}</div>
          <h2 style={{ marginTop: 8 }}>Media &amp; variants</h2>
        </div>
        <button type="button" className="btn" onClick={onGoToPricing} data-testid="goto-pricing">
          Pricing →
        </button>
      </div>

      <div className="insp">
        <div>
          <div className="drop" data-testid="drop-zone">
            <div className="up">
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--rose)" strokeWidth={2}>
                <path d="M12 19V7M5 12l7-7 7 7" />
              </svg>
            </div>
            Drag a 9:16 master here, or connect the AI generation pipeline.
            <br />
            <span className="muted">MP4 / MOV - auto-encodes to HLS</span>
          </div>

          <div className="vlist" data-testid="variant-list">
            {beatVariants.length === 0 ? (
              <p className="muted" data-testid="no-variants">
                No variants on this beat yet. Upload one below.
              </p>
            ) : (
              beatVariants.map((v) => {
                const enc = encodeLabel(v);
                return (
                  <button
                    key={v.id}
                    type="button"
                    className="vrow"
                    data-testid={`variant-row-${v.id}`}
                    onClick={() => beat && onSelectBeat(beat.id)}
                  >
                    <div className={`th ${thumbClass(v)}`} />
                    <div className="meta">
                      <div>
                        {v.is_premium ? "Premium" : "Cut"} - {v.language.toUpperCase()} - intensity{" "}
                        {v.intensity}
                      </div>
                      <div className="muted">
                        {v.tier} - {enc.detail}
                        {v.is_premium ? ` - ${v.coin_cost} coins` : ""}
                      </div>
                    </div>
                    {enc.ready ? (
                      <span className="ok">✓ READY</span>
                    ) : (
                      <span className="muted">⏳</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <UploadVariantInspector beat={beat} onCreated={onCreated} />
      </div>

      <div className="note">
        <span className="notetag">PIPELINE</span>
        Upload → encode to HLS → register as a beat_variant → CDN. Real upload and encode are the generation
        pipeline (out of scope here): this registers the beat_variant row from a playback URL. These fields
        are exactly what the manifest and decision services consume.
      </div>
    </div>
  );
}

type Status =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "ok"; message: string }
  | { state: "error"; message: string };

function UploadVariantInspector({
  beat,
  onCreated,
}: {
  beat: FlatBeat | undefined;
  onCreated: () => void;
}): JSX.Element {
  const client = useContentClient();
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const [intensity, setIntensity] = useState("3");
  const [language, setLanguage] = useState("en");
  const [tier, setTier] = useState<VariantTier>("A_filmed");
  const [isPremium, setIsPremium] = useState(false);
  const [coinCost, setCoinCost] = useState("0");
  const [playbackUrl, setPlaybackUrl] = useState("");
  const [captions, setCaptions] = useState(true);
  const [audioDesc, setAudioDesc] = useState(true);
  const [sign, setSign] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!beat) return;
    setStatus({ state: "submitting" });
    // A placeholder URL if the author has not pasted one (encode is out of scope): keeps the row creatable.
    const url = playbackUrl.trim() || `https://cdn.example/placeholder/${beat.id}.m3u8`;
    try {
      const row = await client.createVariant({
        beat_id: beat.id,
        language: language.trim() || undefined,
        intensity: Number.parseInt(intensity, 10),
        tier,
        is_premium: isPremium,
        coin_cost: Number.parseInt(coinCost, 10) || 0,
        playback_url: url,
        accessibility: { captions, audio_description: audioDesc, sign },
      });
      setStatus({ state: "ok", message: row.id });
      onCreated();
    } catch (err) {
      const message =
        err instanceof ContentApiError
          ? (err.apiError ?? `error_${err.status}`)
          : err instanceof Error
            ? err.message
            : "request_failed";
      setStatus({ state: "error", message });
    }
  };

  return (
    <form onSubmit={onSubmit} aria-label="Upload variant" data-testid="form-variant">
      <div className="fld">
        <label htmlFor="v-cut">Cut</label>
        <select id="v-cut" value={intensity} onChange={(e) => setIntensity(e.target.value)}>
          <option value="5">Tense (intensity 5)</option>
          <option value="3">Neutral (intensity 3)</option>
          <option value="2">Calm (intensity 2)</option>
        </select>
      </div>
      <div className="fld">
        <label htmlFor="v-lang">Language</label>
        <select id="v-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
          <option value="en">English</option>
          <option value="es">Español</option>
          <option value="ar">العربية (UAE)</option>
        </select>
      </div>
      <div className="fld">
        <label>Accessibility tracks</label>
        <div className="langrow">
          <button
            type="button"
            className={`chip${captions ? " on" : ""}`}
            onClick={() => setCaptions((c) => !c)}
            aria-pressed={captions}
          >
            Captions
          </button>
          <button
            type="button"
            className={`chip${audioDesc ? " on" : ""}`}
            onClick={() => setAudioDesc((c) => !c)}
            aria-pressed={audioDesc}
          >
            Audio desc.
          </button>
          <button
            type="button"
            className={`chip${sign ? " on" : ""}`}
            onClick={() => setSign((c) => !c)}
            aria-pressed={sign}
          >
            Sign
          </button>
        </div>
      </div>
      <div className="fld">
        <label htmlFor="v-tier">Tier</label>
        <select id="v-tier" value={tier} onChange={(e) => setTier(e.target.value as VariantTier)}>
          {VARIANT_TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <label className="toggle2" style={{ marginBottom: 12 }}>
        <input
          type="checkbox"
          checked={isPremium}
          onChange={(e) => setIsPremium(e.target.checked)}
        />
        Premium (coin-gated)
      </label>
      {isPremium ? (
        <div className="fld">
          <label htmlFor="v-coins">Coin cost</label>
          <input
            id="v-coins"
            type="number"
            min={0}
            value={coinCost}
            onChange={(e) => setCoinCost(e.target.value)}
          />
        </div>
      ) : null}
      <div className="fld">
        <label htmlFor="v-url">Playback URL (or leave blank for a placeholder)</label>
        <input
          id="v-url"
          value={playbackUrl}
          onChange={(e) => setPlaybackUrl(e.target.value)}
          placeholder="https://cdn/.../master.m3u8"
        />
      </div>
      <div className="fld">
        <label htmlFor="v-prov">Provenance (C2PA)</label>
        <input id="v-prov" value="signed - auto" readOnly />
      </div>
      <div className="rowend">
        <button
          type="submit"
          className="btn pri"
          disabled={status.state === "submitting" || !beat}
        >
          Upload variant
        </button>
      </div>
      {status.state === "ok" ? (
        <p className="statusline ok" role="status" data-testid="form-variant-ok">
          Created {status.message}
        </p>
      ) : null}
      {status.state === "error" ? (
        <p className="statusline err" role="alert" data-testid="form-variant-error">
          Error: {status.message}
        </p>
      ) : null}
    </form>
  );
}
