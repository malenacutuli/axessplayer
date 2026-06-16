// Media & variants panel: a drop zone (drag a 9:16 master, auto-encodes to HLS), the real variant list for
// the selected beat with a truthful encode/QA status, and an inspector (Cut, Language, Accessibility chips,
// Tier, Provenance C2PA). A staged master is uploaded for real and HLS-encoded by the local media server; the
// resulting master.m3u8 is registered as a beat_variant (qa_status passed) via POST /variants, then refreshes.
// A pasted URL or a blank placeholder is registered as-is. Row status never lies: passed reads "encoded",
// placeholder/demo rows read "placeholder (no media)", not a perpetual "encoding...". No em dashes.
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { useContentClient } from "../../api/useContentClient.js";
import { ContentApiError } from "../../api/client.js";
import { VARIANT_TIERS, type VariantTier } from "../../api/contractGap.js";
import { attachHls, deleteMedia, isPlayableVideoUrl, pingMediaServer, uploadAndEncode } from "../../api/media.js";
import type { FlatGraph, FlatBeat, FlatVariant } from "../../api/flattenGraph.js";

export interface MediaPanelProps {
  graph: FlatGraph;
  selectedBeatId: string | null;
  onSelectBeat: (beatId: string) => void;
  onCreated: () => void;
  onGoToPricing: () => void;
  onGoToPublish: () => void;
}

// Map intensity to a poster gradient class for the variant thumbnail, mirroring the prototype.
function thumbClass(v: FlatVariant): string {
  if (v.is_premium) return "g2";
  return v.intensity >= 4 ? "gtense" : v.intensity <= 2 ? "gcalm" : "gp";
}

// A placeholder/demo URL (cdn.example or a /placeholder/ path) was never uploaded and never encoded, so it
// must NOT read "encoding..." forever. Only a real media-server master that has not yet passed QA is pending.
function isPlaceholderUrl(url: string | undefined): boolean {
  if (!url) return true;
  return /cdn\.example|\/placeholder\//i.test(url);
}

type VariantMediaState = "ready" | "pending" | "placeholder" | "rejected";

// The TRUTHFUL row status. qa_status is the source of truth for the encode/QA outcome; a persisted pending row
// is not actively encoding (live encode is shown on the upload form, not here), so pending real media reads
// "uploaded, QA pending" and a placeholder reads "placeholder (no media)". Never a perpetual "encoding...".
function variantMedia(v: FlatVariant): { detail: string; state: VariantMediaState } {
  if (v.qa_status === "passed") return { detail: "encoded", state: "ready" };
  if (v.qa_status === "rejected") return { detail: "rejected", state: "rejected" };
  if (isPlaceholderUrl(v.playback_url)) return { detail: "placeholder (no media)", state: "placeholder" };
  return { detail: "uploaded, QA pending", state: "pending" };
}

export function MediaPanel({
  graph,
  selectedBeatId,
  onSelectBeat,
  onCreated,
  onGoToPricing,
  onGoToPublish,
}: MediaPanelProps): JSX.Element {
  const beat: FlatBeat | undefined =
    (selectedBeatId ? graph.beatById.get(selectedBeatId) : undefined) ?? graph.beats[0];
  const beatVariants = beat ? graph.variants.filter((v) => v.beat_id === beat.id) : [];
  const beatLabel = beat
    ? `Beat - #${beat.beat_index} ${beat.is_branch_point ? "branch point" : beat.role}`
    : "No beat selected";

  // The drop zone stages a local master file. Real upload + HLS encode is the generation pipeline (out of
  // scope), so the file is not sent to a server here; it labels the beat_variant row the form registers.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  // The most recently uploaded or selected playable variant, shown in the preview player so the author can
  // confirm the real video plays.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Media server reachability, so an upload that cannot work is flagged BEFORE the author tries.
  const [mediaUp, setMediaUp] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void pingMediaServer().then((ok) => {
      if (alive) setMediaUp(ok);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Remove a variant: delete the beat_variant row and best-effort prune the encoded video on the media server,
  // then refresh the graph. Confirmed first because it is destructive and not undoable.
  const client = useContentClient();
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const onRemove = async (v: FlatVariant) => {
    const ok = window.confirm(
      `Remove this ${v.is_premium ? "premium " : ""}variant and delete its uploaded video? This cannot be undone.`,
    );
    if (!ok) return;
    setRemoving(v.id);
    setRemoveError(null);
    try {
      await client.deleteVariant(v.id);
      await deleteMedia(v.playback_url);
      if (previewUrl === v.playback_url) setPreviewUrl(null);
      onCreated();
    } catch (err) {
      setRemoveError(
        err instanceof ContentApiError
          ? (err.apiError ?? `error_${err.status}`)
          : err instanceof Error
            ? err.message
            : "remove_failed",
      );
    } finally {
      setRemoving(null);
    }
  };

  const acceptFile = (file: File | null | undefined) => {
    if (file) setPicked(file);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    acceptFile(e.dataTransfer.files?.[0]);
  };

  return (
    <div className="spanel" data-testid="panel-media">
      <div className="sbar">
        <div>
          <div className="ey rose">{beatLabel}</div>
          <h2 style={{ marginTop: 8 }}>Media &amp; variants</h2>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className="btn" onClick={onGoToPricing} data-testid="goto-pricing">
            Pricing →
          </button>
          <button type="button" className="btn pri" onClick={onGoToPublish} data-testid="goto-publish-from-media">
            Publish →
          </button>
        </div>
      </div>

      {mediaUp === false ? (
        <p className="statusline err" role="alert" data-testid="media-server-down">
          Media server not running, so uploads will fail. Start it: node tools/media-server/server.mjs
        </p>
      ) : null}

      <div className="insp">
        <div>
          <div
            className="drop"
            data-testid="drop-zone"
            role="button"
            tabIndex={0}
            aria-label="Choose or drop a 9:16 master video"
            style={{
              cursor: "pointer",
              borderColor: dragging ? "var(--rose)" : undefined,
              background: dragging ? "var(--rose-t)" : undefined,
            }}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4,video/quicktime,.mp4,.mov"
              hidden
              data-testid="file-input"
              onChange={(e) => {
                acceptFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <div className="up">
              <svg viewBox="0 0 24 24" fill="none" stroke="var(--rose)" strokeWidth={2}>
                <path d="M12 19V7M5 12l7-7 7 7" />
              </svg>
            </div>
            {picked ? (
              <>
                <strong data-testid="picked-name">{picked.name}</strong>
                <br />
                <span className="muted">
                  {(picked.size / 1_000_000).toFixed(1)} MB selected. Set the fields and press Upload and
                  encode: it is uploaded and HLS-encoded for real, then plays back here.
                </span>
              </>
            ) : (
              <>
                Click to choose, or drag a 9:16 master here, or connect the AI generation pipeline.
                <br />
                <span className="muted">MP4 / MOV - auto-encodes to HLS</span>
              </>
            )}
          </div>

          <div className="vlist" data-testid="variant-list">
            {beatVariants.length === 0 ? (
              <p className="muted" data-testid="no-variants">
                No variants on this beat yet. Upload one below.
              </p>
            ) : (
              beatVariants.map((v) => {
                const m = variantMedia(v);
                return (
                  <div
                    key={v.id}
                    className="vrowwrap"
                    style={{ display: "flex", alignItems: "stretch", gap: 6 }}
                  >
                    <button
                      type="button"
                      className="vrow"
                      style={{ flex: 1 }}
                      data-testid={`variant-row-${v.id}`}
                      onClick={() => {
                        if (beat) onSelectBeat(beat.id);
                        if (isPlayableVideoUrl(v.playback_url)) setPreviewUrl(v.playback_url);
                      }}
                    >
                      <div className={`th ${thumbClass(v)}`} />
                      <div className="meta">
                        <div>
                          {v.is_premium ? "Premium" : "Cut"} - {v.language.toUpperCase()} - intensity{" "}
                          {v.intensity}
                        </div>
                        <div className="muted" data-testid={`variant-status-${v.id}`}>
                          {v.tier} - {m.detail}
                          {v.is_premium ? ` - ${v.coin_cost} coins` : ""}
                        </div>
                      </div>
                      {m.state === "ready" ? (
                        <span className="ok">✓ READY</span>
                      ) : m.state === "rejected" ? (
                        <span className="muted">✕ rejected</span>
                      ) : m.state === "placeholder" ? (
                        <span className="muted">demo</span>
                      ) : (
                        <span className="muted">⏳ QA</span>
                      )}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      data-testid={`variant-remove-${v.id}`}
                      aria-label="Remove variant"
                      title="Remove this variant and delete its uploaded video"
                      disabled={removing === v.id}
                      onClick={() => void onRemove(v)}
                    >
                      {removing === v.id ? "Removing..." : "Remove"}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {removeError ? (
            <p className="statusline err" role="alert" data-testid="variant-remove-error">
              Remove failed: {removeError}
            </p>
          ) : null}

          {previewUrl ? (
            <div className="preview" data-testid="variant-preview">
              <div className="scaption" style={{ marginTop: 14 }}>Preview</div>
              <PreviewVideo url={previewUrl} />
            </div>
          ) : null}
        </div>

        <UploadVariantInspector
          beat={beat}
          picked={picked}
          onCreated={(createdUrl) => {
            setPicked(null);
            if (isPlayableVideoUrl(createdUrl)) setPreviewUrl(createdUrl);
            onCreated();
          }}
        />
      </div>

      <div className="note">
        <span className="notetag">PIPELINE</span>
        Choose a master and press Upload and encode: the file is uploaded for real to the local media server,
        HLS-encoded (ffmpeg to master.m3u8), registered as a beat_variant with qa_status passed, and plays in
        the preview above and in the consumer app via hls.js. Production swaps the local server for sovereign
        object storage and a CDN (Path A). These fields are what the manifest and decision services consume.
      </div>
    </div>
  );
}

type Status =
  | { state: "idle" }
  | { state: "uploading" }
  | { state: "encoding" }
  | { state: "submitting" }
  | { state: "ok"; message: string }
  | { state: "error"; message: string };

function UploadVariantInspector({
  beat,
  picked,
  onCreated,
}: {
  beat: FlatBeat | undefined;
  picked: File | null;
  onCreated: (createdUrl: string) => void;
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
    try {
      // The REAL ingest lifecycle. A staged master is uploaded and HLS-ENCODED by the media server; we wait
      // for the encode to be READY and register the resulting master.m3u8 with qa_status passed (so the row
      // shows encoded, truthfully). A pasted URL or a blank placeholder is registered as-is (still pending).
      let url = playbackUrl.trim();
      let encoded = false;
      if (picked) {
        const result = await uploadAndEncode(picked, { onState: (s) => setStatus({ state: s }) });
        url = result.url;
        encoded = true;
      } else if (!url) {
        url = `https://cdn.example/placeholder/${beat.id}.m3u8`;
      }
      setStatus({ state: "submitting" });
      const row = await client.createVariant({
        beat_id: beat.id,
        language: language.trim() || undefined,
        intensity: Number.parseInt(intensity, 10),
        tier,
        is_premium: isPremium,
        coin_cost: Number.parseInt(coinCost, 10) || 0,
        playback_url: url,
        accessibility: { captions, audio_description: audioDesc, sign },
        qa_status: encoded ? "passed" : undefined,
      });
      setStatus({ state: "ok", message: row.id });
      onCreated(url);
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
        <label htmlFor="v-url">Playback URL (blank uploads the staged master, or a placeholder)</label>
        <input
          id="v-url"
          value={playbackUrl}
          onChange={(e) => setPlaybackUrl(e.target.value)}
          placeholder={picked ? `uploads ${picked.name}` : "https://cdn/.../master.m3u8"}
        />
        {picked ? (
          <p className="muted" data-testid="picked-hint" style={{ marginTop: 6, fontSize: 12 }}>
            Master staged: {picked.name}. Leave the URL blank to upload it for real and play it back.
          </p>
        ) : null}
      </div>
      <div className="fld">
        <label htmlFor="v-prov">Provenance (C2PA)</label>
        <input id="v-prov" value="signed - auto" readOnly />
      </div>
      <div className="rowend">
        <button
          type="submit"
          className="btn pri"
          disabled={
            status.state === "submitting" ||
            status.state === "uploading" ||
            status.state === "encoding" ||
            !beat
          }
        >
          {status.state === "uploading"
            ? "Uploading..."
            : status.state === "encoding"
              ? "Encoding to HLS..."
              : status.state === "submitting"
                ? "Registering..."
                : picked
                  ? "Upload and encode"
                  : "Upload variant"}
        </button>
      </div>
      {status.state === "uploading" || status.state === "encoding" || status.state === "submitting" ? (
        <p className="statusline" role="status" data-testid="form-variant-progress">
          {status.state === "uploading"
            ? "Uploading master..."
            : status.state === "encoding"
              ? "Encoding to HLS (ffmpeg). The row turns ready on its own."
              : "Registering variant..."}
        </p>
      ) : null}
      {status.state === "ok" ? (
        <p className="statusline ok" role="status" data-testid="form-variant-ok">
          Ready: {status.message}
        </p>
      ) : null}
      {status.state === "error" ? (
        <p className="statusline err" role="alert" data-testid="form-variant-error">
          Failed: {status.message}
        </p>
      ) : null}
    </form>
  );
}

// Plays a variant URL, using hls.js for the encoded master.m3u8 (and native src for plain video).
function PreviewVideo({ url }: { url: string }): JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let alive = true;
    let cleanup = () => {};
    void attachHls(v, url).then((c) => {
      if (alive) cleanup = c;
      else c();
    });
    return () => {
      alive = false;
      cleanup();
    };
  }, [url]);
  return (
    <video
      ref={ref}
      controls
      playsInline
      data-testid="preview-video"
      data-src={url}
      style={{ width: "100%", maxHeight: 340, borderRadius: 12, background: "#000" }}
    />
  );
}
