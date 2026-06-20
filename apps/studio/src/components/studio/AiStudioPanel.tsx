// Section 3 - CREATE WITH AI (/studio/create): the Seedance 2.0 generation studio. Three modes
// (text-to-video, image-to-video, multi-reference), reference-image upload (up to 9, for character lock),
// resolution / duration / aspect-ratio controls, and a gallery of the generated clips. Each generation runs
// the real engine (POST /generate -> Seedance, fallback Runway) and the clip appears in the gallery when
// done. Built on the @axessplayer/ui STUDIO skin. WCAG AA. No em dashes.
import { useMemo, useState, useRef, type DragEvent } from "react";
import { ProvenanceLabel } from "./ProvenanceLabel.js";
import { uploadMaster, isStorageConfigured } from "../../api/storageUpload.js";
import { generateShot, isGenerationConfigured, GenerationError } from "../../api/generation.js";
import type { SectionId } from "../../sections.js";

export interface AiStudioPanelProps {
  onNavigate: (section: SectionId) => void;
}

type Mode = "text-to-video" | "image-to-video" | "reference-to-video";
type RefImage = { url: string; name: string };
type Clip = { url: string; prompt: string; mode: Mode };

const MODES: { id: Mode; label: string; blurb: string }[] = [
  { id: "text-to-video", label: "Text to Video", blurb: "Prompt only." },
  { id: "image-to-video", label: "Image to Video", blurb: "1 image = first frame, 2 = first and last." },
  { id: "reference-to-video", label: "Multi Reference", blurb: "Up to 9 reference images to lock characters." },
];
const RESOLUTIONS = ["480p", "720p", "1080p"] as const;
const ASPECTS = ["9:16", "16:9", "1:1", "4:3", "3:4"];

function uuid(): string {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);
}

export function AiStudioPanel({ onNavigate }: AiStudioPanelProps): JSX.Element {
  const [mode, setMode] = useState<Mode>("reference-to-video");
  const [prompt, setPrompt] = useState("");
  const [refs, setRefs] = useState<RefImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [resolution, setResolution] = useState<(typeof RESOLUTIONS)[number]>("720p");
  const [duration, setDuration] = useState(5);
  const [aspect, setAspect] = useState("9:16");
  const [returnLastFrame, setReturnLastFrame] = useState(false);
  const [genState, setGenState] = useState<"idle" | "generating" | "error">("idle");
  const [genError, setGenError] = useState<string | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const storageReady = useMemo(() => isStorageConfigured(), []);
  const genReady = useMemo(() => isGenerationConfigured(), []);
  const canGenerate = prompt.trim().length >= 4 && genState !== "generating" && (mode === "text-to-video" || refs.length > 0);

  const addRefs = async (files: FileList | File[]) => {
    const images = Array.from(files).filter((f) => /\.(png|jpe?g|webp)$/i.test(f.name) || f.type.startsWith("image/"));
    if (images.length === 0) return;
    setUploading(true);
    try {
      for (const file of images.slice(0, 9 - refs.length)) {
        const { publicUrl } = await uploadMaster(file, "references");
        setRefs((prev) => (prev.length >= 9 ? prev : [...prev, { url: publicUrl, name: file.name }]));
      }
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "upload_failed");
    } finally {
      setUploading(false);
    }
  };

  const onGenerate = async () => {
    if (!canGenerate) return;
    setGenState("generating");
    setGenError(null);
    try {
      const result = await generateShot({
        specId: `shot-${uuid()}`,
        seriesId: uuid(),
        prompt: prompt.trim(),
        tier: "C_ai",
        durationS: duration,
        resolution,
        aspectRatio: aspect,
        returnLastFrame,
        generationMode: mode,
        referenceImageUrls: mode === "text-to-video" ? undefined : refs.map((r) => r.url),
        budgetUsd: 5,
      });
      if (result.accepted?.outputUrl) {
        setClips((prev) => [{ url: result.accepted!.outputUrl, prompt: prompt.trim(), mode }, ...prev]);
        setGenState("idle");
      } else if (result.blocked) {
        setGenError(`Blocked by the consent gate (${result.blocked.reason}).`);
        setGenState("error");
      } else {
        setGenError("No clip was produced. Try again or adjust the prompt.");
        setGenState("error");
      }
    } catch (e) {
      setGenError(e instanceof GenerationError ? e.message : e instanceof Error ? e.message : "generation_failed");
      setGenState("error");
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) void addRefs(e.dataTransfer.files);
  };

  return (
    <div className="spanel" data-testid="panel-create-ai">
      <div className="sbar">
        <div>
          <div className="ey rose">Create with AI</div>
          <h2 style={{ marginTop: 8 }}>AI video studio</h2>
          <p className="muted">
            Generate vertical clips with Seedance 2.0. Upload reference images to lock your characters across
            shots, then build them into episodes. Everything is AI-generated and Article 50 labeled.
          </p>
        </div>
        <ProvenanceLabel mode="generated" testId="create-provenance" />
      </div>

      {!genReady && (
        <p className="statusline err" role="alert" data-testid="ai-not-configured">
          Generation is not configured for this build.
        </p>
      )}

      {/* Mode tabs */}
      <div className="fld">
        <label>Mode</label>
        <div className="langrow" role="radiogroup" aria-label="Generation mode">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={mode === m.id}
              className={mode === m.id ? "chip on" : "chip"}
              onClick={() => setMode(m.id)}
              data-testid={`ai-mode-${m.id}`}
              title={m.blurb}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 4 }}>{MODES.find((m) => m.id === mode)?.blurb}</p>
      </div>

      {/* Reference image upload (not shown in text-to-video) */}
      {mode !== "text-to-video" && (
        <div className="fld">
          <label>
            Reference images <span className="muted">({refs.length}/9 - lock characters by reusing the same refs)</span>
          </label>
          {!storageReady && <p className="statusline err" role="alert">Storage is not configured; cannot upload references.</p>}
          <div
            className="dropzone"
            onDragOver={(e) => e.preventDefault()}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            role="button"
            tabIndex={0}
            data-testid="ai-ref-dropzone"
            style={{ border: "1px dashed var(--line, #ccc)", borderRadius: 8, padding: 16, textAlign: "center", cursor: "pointer" }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              hidden
              onChange={(e) => e.target.files && void addRefs(e.target.files)}
            />
            {uploading ? "Uploading..." : "Click or drop images (png, jpg, webp, up to 9)"}
          </div>
          {refs.length > 0 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }} data-testid="ai-ref-thumbs">
              {refs.map((r, i) => (
                <div key={r.url} style={{ position: "relative" }}>
                  <img src={r.url} alt={r.name} style={{ width: 64, height: 96, objectFit: "cover", borderRadius: 6, background: "#000" }} />
                  <button
                    type="button"
                    className="btn"
                    aria-label={`Remove ${r.name}`}
                    onClick={() => setRefs((prev) => prev.filter((_, j) => j !== i))}
                    style={{ position: "absolute", top: -6, right: -6, padding: "0 6px", borderRadius: 12 }}
                  >
                    x
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Prompt */}
      <div className="fld">
        <label htmlFor="ai-prompt">Prompt <span className="muted">({prompt.length}/5000)</span></label>
        <textarea
          id="ai-prompt"
          className="ta"
          rows={4}
          maxLength={5000}
          value={prompt}
          placeholder="Vertical adult animated sci-fi satire: MAYA in a purple hoodie reacts to a glitching AI avatar in her neon apartment..."
          onChange={(e) => setPrompt(e.target.value)}
          data-testid="ai-prompt"
        />
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div className="fld">
          <label>Resolution</label>
          <div className="langrow">
            {RESOLUTIONS.map((r) => (
              <button key={r} type="button" className={resolution === r ? "chip on" : "chip"} onClick={() => setResolution(r)} data-testid={`ai-res-${r}`}>{r}</button>
            ))}
          </div>
        </div>
        <div className="fld">
          <label htmlFor="ai-duration">Duration ({duration}s)</label>
          <input id="ai-duration" type="range" min={4} max={15} value={duration} onChange={(e) => setDuration(Number(e.target.value))} data-testid="ai-duration" />
        </div>
        <div className="fld">
          <label>Aspect ratio</label>
          <div className="langrow">
            {ASPECTS.map((a) => (
              <button key={a} type="button" className={aspect === a ? "chip on" : "chip"} onClick={() => setAspect(a)} data-testid={`ai-aspect-${a}`}>{a}</button>
            ))}
          </div>
        </div>
        <div className="fld">
          <label>Return last frame</label>
          <button type="button" className={returnLastFrame ? "chip on" : "chip"} aria-pressed={returnLastFrame} onClick={() => setReturnLastFrame((v) => !v)} data-testid="ai-return-last-frame">
            {returnLastFrame ? "On (for chaining)" : "Off"}
          </button>
        </div>
      </div>

      <div className="btnrow" style={{ marginTop: 12 }}>
        <button type="button" className="btn pri" disabled={!canGenerate} onClick={() => void onGenerate()} data-testid="ai-generate">
          {genState === "generating" ? "Generating (a few minutes)..." : "Generate clip"}
        </button>
        <button type="button" className="btn" onClick={() => onNavigate("upload")} data-testid="ai-goto-upload">Upload a master instead</button>
      </div>

      {genState === "generating" && (
        <p className="statusline" role="status" data-testid="ai-progress" style={{ marginTop: 8 }}>
          Generating on Seedance 2.0. This runs for a few minutes; the clip appears in the gallery below when done.
        </p>
      )}
      {genState === "error" && (
        <p className="statusline err" role="alert" data-testid="ai-error" style={{ marginTop: 8 }}>{genError}</p>
      )}

      {/* Gallery */}
      <div className="fld" style={{ marginTop: 16 }}>
        <label>Generated clips {clips.length > 0 ? `(${clips.length})` : ""}</label>
        {clips.length === 0 ? (
          <p className="muted" data-testid="ai-gallery-empty">No clips yet. Generate one above and it will appear here.</p>
        ) : (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }} data-testid="ai-gallery">
            {clips.map((c, i) => (
              <div key={c.url} className="inspcard" style={{ width: 200 }}>
                <video src={c.url} controls playsInline style={{ width: "100%", borderRadius: 6, background: "#000" }} data-testid={`ai-clip-${i}`} />
                <p className="muted" style={{ fontSize: 12, marginTop: 4, maxHeight: 48, overflow: "hidden" }}>{c.prompt}</p>
                <a className="btn" href={c.url} target="_blank" rel="noreferrer" style={{ marginTop: 4 }}>Open</a>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="note" style={{ marginTop: 12 }}>
        <span className="notetag">SIGNED AND LABELED</span>
        Every clip is AI-generated, Article 50 labeled. Reuse the same reference images across clips to keep your
        characters consistent.
      </div>
    </div>
  );
}
