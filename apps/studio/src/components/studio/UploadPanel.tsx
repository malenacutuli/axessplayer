// Section 4 - UPLOAD (/studio/upload): the default upload journey. The creator drops one or more 9:16
// masters; each is uploaded DIRECTLY from the browser to the PUBLIC Supabase storage "videos" bucket (no
// local media-server, which is not deployed) and registered as a beat variant on the chosen series with the
// public storage URL as playback_url. The creator does NOT hand-build each variant: by default a dropped
// master lands on the next open beat and we register it for them. After registration, a "Process
// accessibility" CTA kicks the ingestion factory (POST /produce) so upload -> produce is one flow.
//
// The manual per-variant authoring screen (the existing Media panel) is exposed only as a PRO override
// (data-pro-only), not the default path. Real per-file progress (uploading -> registering -> done -> error)
// with no dead ends. Reuses api/storageUpload.ts (the real direct-to-storage loop), the content client
// createVariant, and the ingestion client produce. Built on the @axessplayer/ui STUDIO skin. WCAG AA. No em
// dashes.
import { useMemo, useRef, useState, type DragEvent } from "react";
import { useContentClient } from "../../api/useContentClient.js";
import { useIngestionClient } from "../../api/useIngestionClient.js";
import { useFlatGraph } from "../../api/useFlatGraph.js";
import { uploadMaster, isStorageConfigured, StorageUploadError } from "../../api/storageUpload.js";
import { ContentApiError } from "../../api/client.js";
import { IngestionApiError, type ProduceTargets } from "../../api/ingestion.js";
import { SeriesPicker } from "./SeriesPicker.js";
import { ProvenanceLabel } from "./ProvenanceLabel.js";
import type { SectionId } from "../../sections.js";
import type { FlatBeat, FlatGraph } from "../../api/flattenGraph.js";

export interface UploadPanelProps {
  // Whether the creator is in Pro mode; gates the manual per-variant override entry.
  proMode: boolean;
  onNavigate: (section: SectionId) => void;
}

// Per-row upload lifecycle. Mirrors the slice spec: uploading -> registering -> done -> error.
type RowState = "queued" | "uploading" | "registering" | "done" | "error";
// Per-row accessibility-produce lifecycle, available only after the variant is registered (done).
type ProduceState = "idle" | "producing" | "queued" | "error";

interface RowItem {
  id: string;
  name: string;
  size: number;
  state: RowState;
  message?: string;
  beatLabel?: string;
  // The beat + episode this master landed on, so the per-row Process CTA can target the right episode.
  beatId?: string;
  episodeId?: string;
  // Upload progress in [0,1] while state is "uploading" (resumable chunks complete), for the progress bar.
  progress?: number;
  // Accessibility produce state for the per-row CTA.
  produce: ProduceState;
  produceJobId?: string;
  produceMessage?: string;
}

// The next beat to attach an uploaded master to: the first beat with no variants, else the first beat. This
// is the "do not make creators hand-build each variant" default; Pro can override beat-by-beat in Media.
function nextOpenBeat(graph: FlatGraph): FlatBeat | undefined {
  const open = graph.beats.find((b) => b.variant_ids.length === 0);
  return open ?? graph.beats[0];
}

// Sensible accessibility targets for a one-click per-master Process: every track on (opt-out by default),
// base + one common language, ASL sign, standard cost tier. The PROCESS panel is where the creator tunes
// these once; this CTA just kicks the factory so upload -> produce is one flow.
const DEFAULT_TARGETS: ProduceTargets = {
  languages: ["en", "es"],
  tracks: { cc: true, ad: true, sign: true, dub: true },
  signLanguages: ["ASL"],
  costTier: "standard",
};

let rowSeq = 0;

export function UploadPanel({ proMode, onNavigate }: UploadPanelProps): JSX.Element {
  const client = useContentClient();
  const ingestion = useIngestionClient();
  const [seriesId, setSeriesId] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const graphState = useFlatGraph(seriesId, reloadToken);
  const [rows, setRows] = useState<RowItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const graph = graphState.status === "loaded" ? graphState.graph : null;
  // Whether the public storage project is wired for this build. When false the dropzone is disabled and we
  // explain why, rather than letting a drop fail mid-flight.
  const storageReady = useMemo(() => isStorageConfigured(), []);

  const busy = useMemo(
    () => rows.some((r) => r.state === "uploading" || r.state === "registering"),
    [rows],
  );

  const patchRow = (id: string, patch: Partial<RowItem>) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  // Upload + register one master onto the next open beat. Errors are surfaced per row, never silent. The
  // bytes go DIRECTLY to public storage from the browser; the content service only records the public URL.
  // Ensure the series has at least one beat to attach a master to. A freshly created series has no episodes
  // or beats; rather than dead-ending the creator, scaffold Episode N+1 + an opening beat for them (the
  // "do not make creators hand-build structure" default). Pro can author episodes/beats explicitly in Media.
  const ensureBeat = async (g: FlatGraph): Promise<FlatGraph> => {
    if (nextOpenBeat(g)) return g;
    const number = g.episodeCount + 1;
    const ep = await client.createEpisode({
      series_id: g.seriesId,
      episode_number: number,
      title: `Episode ${number}`,
    });
    await client.createBeat({
      series_id: g.seriesId,
      episode_id: ep.id,
      beat_index: 0,
      role: "cold_open",
    });
    return client.getFlatGraph(g.seriesId);
  };

  const handleFiles = async (files: FileList | File[]) => {
    if (!graph) return;
    const list = Array.from(files).filter(
      (f) => f.type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(f.name),
    );
    if (list.length === 0) return;

    // Scaffold a home beat once for this drop if the series is empty, then reuse the refreshed graph.
    let workingGraph = graph;
    try {
      workingGraph = await ensureBeat(workingGraph);
    } catch (e) {
      const id = `row-${++rowSeq}`;
      setRows((prev) => [
        ...prev,
        { id, name: list[0]?.name ?? "upload", size: 0, state: "error", produce: "idle",
          message: e instanceof ContentApiError ? e.apiError ?? `content_error_${e.status}` : "Could not prepare the series for upload." },
      ]);
      return;
    }

    for (const file of list) {
      const id = `row-${++rowSeq}`;
      const beat = nextOpenBeat(workingGraph);
      const beatLabel = beat ? `Episode ${beat.episode_number}, beat ${beat.beat_index + 1}` : "no beat";
      setRows((prev) => [
        ...prev,
        { id, name: file.name, size: file.size, state: "queued", beatLabel, produce: "idle" },
      ]);
      if (!beat) {
        patchRow(id, { state: "error", message: "This series has no beats yet." });
        continue;
      }
      try {
        patchRow(id, { state: "uploading", progress: 0 });
        const { publicUrl } = await uploadMaster(file, workingGraph.seriesId, {
          onProgress: (fraction) => patchRow(id, { progress: fraction }),
        });
        patchRow(id, { state: "registering" });
        await client.createVariant({
          beat_id: beat.id,
          tier: "A_filmed",
          playback_url: publicUrl,
          // Accessible by default: a freshly uploaded master is flagged for the Process fan-out to enrich.
          accessibility: { captions: false, audio_description: false, sign: false },
        });
        patchRow(id, { state: "done", beatId: beat.id, episodeId: beat.episode_id });
        setReloadToken((n) => n + 1);
      } catch (e) {
        const message =
          e instanceof StorageUploadError
            ? e.message
            : e instanceof ContentApiError
              ? e.apiError ?? `content_error_${e.status}`
              : e instanceof Error
                ? e.message
                : "upload_failed";
        patchRow(id, { state: "error", message });
      }
    }
  };

  // Per-row "Process accessibility": kick the ingestion factory (POST /produce) for the episode this master
  // landed on, so upload and produce are one flow. The executor runs async; we surface the enqueue result.
  const handleProcess = async (row: RowItem) => {
    if (!graph || !row.episodeId) return;
    patchRow(row.id, { produce: "producing", produceMessage: undefined });
    try {
      const r = await ingestion.produce({
        seriesId: graph.seriesId,
        episodeId: row.episodeId,
        targets: DEFAULT_TARGETS,
      });
      patchRow(row.id, { produce: "queued", produceJobId: r.jobId });
    } catch (e) {
      const message =
        e instanceof IngestionApiError
          ? e.status === 501 || e.status === 404
            ? "The processing service is not connected in this environment yet."
            : e.apiError ?? `error_${e.status}`
          : e instanceof Error
            ? e.message
            : "process_failed";
      patchRow(row.id, { produce: "error", produceMessage: message });
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files?.length) void handleFiles(e.dataTransfer.files);
  };

  const dzDisabled = !graph || !storageReady;

  return (
    <div className="spanel" data-testid="panel-upload">
      <div className="sbar">
        <div>
          <div className="ey rose">Upload</div>
          <h2 style={{ marginTop: 8 }}>Upload masters</h2>
          <p className="muted">
            Drop 9:16 masters. Each uploads straight to your library and we register it on a beat for you.
            No hand-building variants.
          </p>
        </div>
        <ProvenanceLabel mode="assisted" testId="upload-provenance" />
      </div>

      <SeriesPicker
        selectedId={seriesId}
        onSelect={setSeriesId}
        label="Upload into which series"
        manage
        onChanged={() => setReloadToken((n) => n + 1)}
      />

      {!storageReady && (
        <p className="statusline err" role="alert" data-testid="upload-storage-unconfigured">
          Storage is not configured for this build. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to
          enable uploads.
        </p>
      )}

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
            onClick={() => {
              if (!dzDisabled) inputRef.current?.click();
            }}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !dzDisabled) {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!dzDisabled) setDragging(true);
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
                    {r.state === "uploading" &&
                      (r.progress != null && r.progress > 0
                        ? `Uploading... ${Math.round(r.progress * 100)}%`
                        : "Uploading...")}
                    {r.state === "registering" && "Registering variant..."}
                    {r.state === "done" && "Registered"}
                    {r.state === "error" && <span role="alert">Failed: {r.message}</span>}
                  </span>

                  {/* After registration: one-click Process accessibility (POST /produce) for this episode. */}
                  {r.state === "done" && (
                    <span className="uploadrow__produce" data-testid={`upload-produce-${r.id}`}>
                      {r.produce === "idle" && (
                        <button
                          type="button"
                          className="btn btn-sm"
                          data-testid={`upload-produce-btn-${r.id}`}
                          onClick={() => void handleProcess(r)}
                        >
                          Process accessibility
                        </button>
                      )}
                      {r.produce === "producing" && (
                        <span className="muted" role="status">
                          Starting...
                        </span>
                      )}
                      {r.produce === "queued" && (
                        <button
                          type="button"
                          className="btn btn-sm btn-ghost"
                          data-testid={`upload-produce-goto-${r.id}`}
                          onClick={() => onNavigate("process")}
                        >
                          Processing started - track it
                        </button>
                      )}
                      {r.produce === "error" && (
                        <span className="statusline err" role="alert" data-testid={`upload-produce-error-${r.id}`}>
                          {r.produceMessage}
                        </span>
                      )}
                    </span>
                  )}
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
        After your masters are in, hit Process accessibility (or set targets once in Process) and the factory
        fans out captions, audio description, sign, and dubs. Each derivative is signed and Article 50
        labeled.
      </div>
    </div>
  );
}
