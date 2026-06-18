// Section 4 - UPLOAD (/studio/upload): the default upload journey. The creator drops one or more 9:16
// masters; each is encoded to HLS by the existing media-server (uploadAndEncode) and registered as a beat
// variant on the chosen series. The creator does NOT hand-build each variant: by default a dropped master
// lands on the next open beat and we register it for them. The manual per-variant authoring screen (the
// existing Media panel) is exposed only as a PRO override (data-pro-only), not the default path.
//
// Real loading / empty / error states and no dead ends. Reuses api/media.ts (the real media-server loop)
// and the content client createVariant. Built on the @axessplayer/ui STUDIO skin. No em dashes.
import { useMemo, useRef, useState, type DragEvent } from "react";
import { useContentClient } from "../../api/useContentClient.js";
import { useFlatGraph } from "../../api/useFlatGraph.js";
import { uploadAndEncode, type IngestState } from "../../api/media.js";
import { ContentApiError } from "../../api/client.js";
import { SeriesPicker } from "./SeriesPicker.js";
import { ProvenanceLabel } from "./ProvenanceLabel.js";
import type { SectionId } from "../../sections.js";
import type { FlatBeat, FlatGraph } from "../../api/flattenGraph.js";

export interface UploadPanelProps {
  // Whether the creator is in Pro mode; gates the manual per-variant override entry.
  proMode: boolean;
  onNavigate: (section: SectionId) => void;
}

interface RowState {
  id: string;
  name: string;
  size: number;
  state: "queued" | IngestState | "registering" | "done" | "error";
  message?: string;
  beatLabel?: string;
}

// The next beat to attach an uploaded master to: the first beat with no variants, else the first beat. This
// is the "do not make creators hand-build each variant" default; Pro can override beat-by-beat in Media.
function nextOpenBeat(graph: FlatGraph): FlatBeat | undefined {
  const open = graph.beats.find((b) => b.variant_ids.length === 0);
  return open ?? graph.beats[0];
}

let rowSeq = 0;

export function UploadPanel({ proMode, onNavigate }: UploadPanelProps): JSX.Element {
  const client = useContentClient();
  const [seriesId, setSeriesId] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const graphState = useFlatGraph(seriesId, reloadToken);
  const [rows, setRows] = useState<RowState[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const graph = graphState.status === "loaded" ? graphState.graph : null;

  const busy = useMemo(() => rows.some((r) => r.state !== "done" && r.state !== "error" && r.state !== "queued"), [rows]);

  // Upload + encode + register one master onto the next open beat. Errors are surfaced per row, never silent.
  const handleFiles = async (files: FileList | File[]) => {
    if (!graph) return;
    const list = Array.from(files).filter((f) => f.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(f.name));
    if (list.length === 0) return;

    for (const file of list) {
      const id = `row-${++rowSeq}`;
      const beat = nextOpenBeat(graph);
      const beatLabel = beat ? `Episode ${beat.episode_number}, beat ${beat.beat_index + 1}` : "no beat";
      setRows((prev) => [...prev, { id, name: file.name, size: file.size, state: "queued", beatLabel }]);
      if (!beat) {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, state: "error", message: "This series has no beats yet." } : r)));
        continue;
      }
      try {
        const { url } = await uploadAndEncode(file, {
          onState: (s) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, state: s } : r))),
        });
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, state: "registering" } : r)));
        await client.createVariant({
          beat_id: beat.id,
          tier: "A_filmed",
          playback_url: url,
          // Accessible by default: a freshly uploaded master is flagged for the Process fan-out to enrich.
          accessibility: { captions: false, audio_description: false, sign: false },
        });
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, state: "done" } : r)));
        setReloadToken((n) => n + 1);
      } catch (e) {
        const message =
          e instanceof ContentApiError
            ? e.apiError ?? `content_error_${e.status}`
            : e instanceof Error
              ? e.message
              : "upload_failed";
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, state: "error", message } : r)));
      }
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files?.length) void handleFiles(e.dataTransfer.files);
  };

  const dzDisabled = !graph;

  return (
    <div className="spanel" data-testid="panel-upload">
      <div className="sbar">
        <div>
          <div className="ey rose">Upload</div>
          <h2 style={{ marginTop: 8 }}>Upload masters</h2>
          <p className="muted">
            Drop 9:16 masters. We encode each to HLS and register it on a beat for you. No hand-building
            variants.
          </p>
        </div>
        <ProvenanceLabel mode="assisted" testId="upload-provenance" />
      </div>

      <SeriesPicker selectedId={seriesId} onSelect={setSeriesId} label="Upload into which series" />

      {seriesId && graphState.status === "loading" && (
        <p className="muted" data-testid="upload-graph-loading">
          Loading the series...
        </p>
      )}
      {seriesId && graphState.status === "error" && (
        <p className="statusline err" role="alert" data-testid="upload-graph-error">
          Could not load the series: {graphState.message}
        </p>
      )}

      {graph && (
        <>
          <div
            className={dragging ? "dropzone dragging" : "dropzone"}
            role="button"
            tabIndex={0}
            aria-label="Choose or drop one or more 9:16 master videos"
            aria-disabled={dzDisabled}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            data-testid="upload-dropzone"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden width={34} height={34}>
              <path d="M12 16V4M7 9l5-5 5 5" />
              <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
            </svg>
            <p>
              <b>Click to choose</b> or drag 9:16 masters here
            </p>
            <p className="muted">MP4, MOV, or WebM. Each lands on the next open beat.</p>
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              multiple
              hidden
              data-testid="upload-input"
              onChange={(e) => {
                if (e.target.files?.length) void handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          {rows.length === 0 ? (
            <p className="muted" data-testid="upload-empty" style={{ marginTop: 10 }}>
              No uploads yet. Drop a master to begin.
            </p>
          ) : (
            <ul className="uploadlist" data-testid="upload-list" style={{ marginTop: 10 }}>
              {rows.map((r) => (
                <li key={r.id} className="uploadrow" data-testid={`upload-row-${r.id}`} data-state={r.state}>
                  <span className="uploadrow__name">{r.name}</span>
                  <span className="uploadrow__beat muted">{r.beatLabel}</span>
                  <span className={`uploadrow__state state-${r.state}`}>
                    {r.state === "queued" && "Queued"}
                    {r.state === "uploading" && "Uploading..."}
                    {r.state === "encoding" && "Encoding to HLS..."}
                    {r.state === "registering" && "Registering variant..."}
                    {r.state === "done" && "Registered"}
                    {r.state === "error" && (
                      <span role="alert">Failed: {r.message}</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {busy && (
            <p className="muted" role="status" data-testid="upload-busy" style={{ marginTop: 8 }}>
              Working... you can keep dropping more masters.
            </p>
          )}
        </>
      )}

      {/* PRO override: hand-build a single variant beat-by-beat. Hidden unless Pro mode is on. */}
      {proMode && (
        <div className="entrycard" data-pro-only data-testid="upload-pro-override" style={{ marginTop: 14 }}>
          <div className="ey rose">Pro</div>
          <h3>Manual variant authoring</h3>
          <p className="muted">
            Need to place a specific master on a specific beat, set tier, premium, and per-variant
            accessibility by hand? Use the Media screen. This is an override, not the default.
          </p>
          <button type="button" className="btn" onClick={() => onNavigate("media")} data-testid="upload-goto-media">
            Open Media (manual)
          </button>
        </div>
      )}

      <div className="note">
        <span className="notetag">UPLOAD ONCE</span>
        After your masters are in, set accessibility targets once in Process and the factory fans out
        captions, audio description, sign, and dubs. Each derivative is signed and Article 50 labeled.
      </div>
    </div>
  );
}
