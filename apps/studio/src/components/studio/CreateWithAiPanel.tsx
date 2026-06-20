// Section 3 - CREATE WITH AI (/studio/create): the prompt-to-series showrunner. The creator types a
// premise; the writers-room pipeline expands it through model-agnostic stages (beat graph -> variants ->
// branches -> dialogue -> key frames). The pipeline is shown as discrete STAGES with a visible COST GATE:
// the estimated credits are computed BEFORE anything runs, and the creator must confirm. A hands-off toggle
// (accept the whole draft) vs hands-on (review each stage) controls how much the creator edits.
//
// This panel does NOT fabricate outputs: the generation backend (the writers-room router) is not wired
// here, so the stages render in a graceful "preview cost -> generate" state. When wired, each stage flips
// to its produced artifact. Everything generated carries the C2PA + Article 50 provenance label.
//
// Two adjacent entries the brief calls for: an AI live-action adaptation entry (footage repurposing, which
// is CONSENT-GATED and links to the later likeness flow, built but not live), and an upload-master dropzone
// that hands off to the Upload section. Built on the @axessplayer/ui STUDIO skin. No em dashes.
import { useMemo, useState } from "react";
import { ProvenanceLabel } from "./ProvenanceLabel.js";
import type { SectionId } from "../../sections.js";
import { generateEpisode, isGenerationConfigured, GenerationError, type GenerateEpisodeResult } from "../../api/generation.js";

export interface CreateWithAiPanelProps {
  // Navigate to a sibling studio section (upload, process). Keeps the panel a non-dead-end surface.
  onNavigate: (section: SectionId) => void;
}

type Mode = "hands_off" | "hands_on";

interface PipelineStage {
  id: string;
  label: string;
  blurb: string;
  // Estimated credits this stage costs to generate (the cost gate sums these).
  credits: number;
}

// The writers-room pipeline (model-agnostic router stages). Credits are estimates the cost gate sums; the
// real numbers come from the router when wired. Ordered as the showrunner expands a premise.
const PIPELINE: PipelineStage[] = [
  { id: "beats", label: "Beat graph", blurb: "Expand the premise into an episode beat structure.", credits: 18 },
  { id: "variants", label: "Variants", blurb: "Alternate cuts per beat (intensity, POV).", credits: 24 },
  { id: "branches", label: "Branches", blurb: "Decision points and the paths between beats.", credits: 16 },
  { id: "dialogue", label: "Dialogue", blurb: "Scene dialogue and direction per beat.", credits: 22 },
  { id: "keyframes", label: "Key frames", blurb: "Representative frames per beat for the storyboard.", credits: 40 },
];

type StageState = "idle" | "previewing" | "unwired";

export function CreateWithAiPanel({ onNavigate }: CreateWithAiPanelProps): JSX.Element {
  const [premise, setPremise] = useState("");
  const [mode, setMode] = useState<Mode>("hands_off");
  // Which stages the creator has included (all on by default; hands-on can trim before committing cost).
  const [included, setIncluded] = useState<Record<string, boolean>>(
    () => Object.fromEntries(PIPELINE.map((s) => [s.id, true])),
  );
  // The cost gate flow: false until the creator asks to preview cost; the confirm button only appears then.
  const [gateOpen, setGateOpen] = useState(false);
  const [stageState, setStageState] = useState<StageState>("idle");
  // Real generation against the live engine: state + the returned QA result.
  const [genState, setGenState] = useState<"idle" | "generating" | "done" | "error">("idle");
  const [genResult, setGenResult] = useState<GenerateEpisodeResult | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const genConfigured = useMemo(() => isGenerationConfigured(), []);
  const uuid = () =>
    (globalThis.crypto?.randomUUID?.() ??
      "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      }));

  const trimmedPremise = premise.trim();
  const canPlan = trimmedPremise.length >= 12;

  const estimate = useMemo(() => {
    const rows = PIPELINE.filter((s) => included[s.id]);
    const credits = rows.reduce((sum, s) => sum + s.credits, 0);
    return { rows, credits };
  }, [included]);

  const toggleStage = (id: string) =>
    setIncluded((prev) => ({ ...prev, [id]: !prev[id] }));

  const onPreviewCost = () => {
    if (!canPlan) return;
    setGateOpen(true);
    setStageState("previewing");
  };

  // Generate is COST-GATED: it only acts after the creator confirms the estimate. When the engine is wired,
  // this runs a REAL consistency-checked shot through the live router + QA + consent + cost gates and shows
  // the result. When unconfigured, it resolves to a graceful "not connected" state, never a fabricated draft.
  const onConfirmGenerate = async () => {
    if (!genConfigured) {
      setStageState("unwired");
      return;
    }
    setGenState("generating");
    setGenError(null);
    setGenResult(null);
    try {
      // Generate a CONTINUOUS episode: the premise is expanded into shots and stitched into one video.
      const result = await generateEpisode({
        specId: `episode-${uuid()}`,
        seriesId: uuid(),
        premise: trimmedPremise,
        count: 12, // ~60s at 5s/shot
        budgetUsd: 12,
      });
      setGenResult(result);
      setGenState("done");
    } catch (e) {
      setGenError(e instanceof GenerationError ? e.message : e instanceof Error ? e.message : "generation_failed");
      setGenState("error");
    }
  };

  return (
    <div className="spanel" data-testid="panel-create-ai">
      <div className="sbar">
        <div>
          <div className="ey rose">Create with AI</div>
          <h2 style={{ marginTop: 8 }}>Showrunner</h2>
          <p className="muted">
            Describe a premise. The writers room expands it into a beat graph, variants, branches, dialogue,
            and key frames. You confirm the cost before anything runs.
          </p>
        </div>
        <ProvenanceLabel mode="generated" testId="create-provenance" />
      </div>

      <div className="fld">
        <label htmlFor="create-premise">Premise</label>
        <textarea
          id="create-premise"
          className="ta"
          rows={3}
          value={premise}
          placeholder="A deaf cartographer in a flooded city discovers the tides are spelling a warning."
          onChange={(e) => {
            setPremise(e.target.value);
            // A premise change invalidates the open cost gate so the creator re-confirms.
            setGateOpen(false);
            setStageState("idle");
          }}
          data-testid="create-premise"
        />
        {!canPlan && trimmedPremise.length > 0 && (
          <p className="muted" data-testid="create-premise-hint" style={{ marginTop: 4 }}>
            Add a little more detail (at least a sentence) so the showrunner has something to expand.
          </p>
        )}
      </div>

      <div className="fld">
        <label>Workflow</label>
        <div className="langrow" role="radiogroup" aria-label="Workflow mode">
          <button
            type="button"
            role="radio"
            aria-checked={mode === "hands_off"}
            className={mode === "hands_off" ? "chip on" : "chip"}
            onClick={() => setMode("hands_off")}
            data-testid="create-mode-hands-off"
          >
            Hands off (accept the draft)
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "hands_on"}
            className={mode === "hands_on" ? "chip on" : "chip"}
            onClick={() => setMode("hands_on")}
            data-testid="create-mode-hands-on"
          >
            Hands on (edit each stage)
          </button>
        </div>
      </div>

      <div className="fld">
        <label>
          Pipeline stages{" "}
          <span className="muted">
            {mode === "hands_on" ? "(toggle a stage off to skip it and lower the cost)" : "(the full draft runs end to end)"}
          </span>
        </label>
        <ol className="stagelist" data-testid="create-stages">
          {PIPELINE.map((s, i) => {
            const on = included[s.id];
            return (
              <li key={s.id} className={on ? "stagerow" : "stagerow off"} data-testid={`create-stage-${s.id}`}>
                <span className="stagerow__num" aria-hidden>
                  {i + 1}
                </span>
                <span className="stagerow__body">
                  <span className="stagerow__label">{s.label}</span>
                  <span className="stagerow__blurb muted">{s.blurb}</span>
                </span>
                <span className="stagerow__cost">{s.credits} cr</span>
                {mode === "hands_on" && (
                  <button
                    type="button"
                    className={on ? "chip on" : "chip"}
                    aria-pressed={on}
                    aria-label={`${on ? "Skip" : "Include"} ${s.label}`}
                    onClick={() => {
                      toggleStage(s.id);
                      setGateOpen(false);
                      setStageState("idle");
                    }}
                    data-testid={`create-stage-toggle-${s.id}`}
                  >
                    {on ? "Included" : "Skipped"}
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {/* COST GATE: estimated credits BEFORE commit; the creator confirms. No generation without confirm. */}
      <div className="inspcard" data-testid="create-cost-gate" style={{ marginTop: 12 }}>
        <div className="scaption">Cost gate</div>
        <div className="kv" style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
          <span>Estimated to generate this draft</span>
          <b data-testid="create-cost">{estimate.credits} credits</b>
        </div>
        <p className="muted" style={{ marginTop: 4 }}>
          Nothing is generated and nothing is charged until you confirm.
        </p>
        <div className="btnrow" style={{ marginTop: 10 }}>
          {!gateOpen && (
            <button
              type="button"
              className="btn pri"
              onClick={onPreviewCost}
              disabled={!canPlan}
              data-testid="create-preview-cost"
            >
              Preview cost
            </button>
          )}
          {gateOpen && stageState !== "unwired" && genState !== "done" && (
            <>
              <button
                type="button"
                className="btn pri"
                onClick={() => void onConfirmGenerate()}
                disabled={genState === "generating"}
                data-testid="create-confirm-generate"
              >
                {genState === "generating" ? "Generating episode (this takes a few minutes)..." : `Confirm and generate ${estimate.credits} credits`}
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setGateOpen(false);
                  setStageState("idle");
                  setGenState("idle");
                }}
                data-testid="create-cancel"
              >
                Cancel
              </button>
            </>
          )}
        </div>
        {genState === "generating" && (
          <p className="statusline" role="status" data-testid="create-gen-progress" style={{ marginTop: 10 }}>
            Expanding the premise into shots, generating each one, and stitching them into a continuous episode.
            This runs for several minutes. Keep this tab open.
          </p>
        )}
        {stageState === "unwired" && (
          <p className="statusline" role="status" data-testid="create-unwired" style={{ marginTop: 10 }}>
            The showrunner router is not connected in this environment. When it is, the {estimate.rows.length}{" "}
            confirmed stages run here and each produces an editable artifact, signed and labeled.
          </p>
        )}

        {genState === "error" && (
          <p className="statusline err" role="alert" data-testid="create-gen-error" style={{ marginTop: 10 }}>
            Generation failed: {genError}
          </p>
        )}

        {genState === "done" && genResult && (
          <div className="inspcard" data-testid="create-gen-result" style={{ marginTop: 10 }}>
            <div className="scaption">Episode result</div>
            {genResult.episodeUrl ? (
              <>
                <p className="statusline ok" role="status">
                  Generated a continuous episode from {genResult.shotCount} shots
                  {genResult.stitched ? ", stitched into one video" : ""}. AI-generated, Article 50 labeled.
                </p>
                <video
                  src={genResult.episodeUrl}
                  controls
                  playsInline
                  data-testid="create-gen-video"
                  style={{ width: "100%", maxWidth: 320, borderRadius: 8, marginTop: 8, background: "#000" }}
                />
                <div className="kv" style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                  <span>Shots stitched</span>
                  <b data-testid="create-gen-shots">{genResult.shotCount}</b>
                </div>
                <div className="kv" style={{ display: "flex", justifyContent: "space-between", padding: "3px 0" }}>
                  <span>Estimated spend</span>
                  <b>${genResult.spentUsd.toFixed(2)}</b>
                </div>
                <a className="btn" href={genResult.episodeUrl} target="_blank" rel="noreferrer" data-testid="create-gen-open" style={{ marginTop: 8 }}>
                  Open the episode
                </a>
              </>
            ) : genResult.paused ? (
              <p className="statusline" role="status" data-testid="create-gen-paused">
                Paused by the cost gate after {genResult.shotCount} shots ({genResult.spentUsd.toFixed(2)} spent).
                Raise the budget to generate the full episode. Nothing over budget was charged.
              </p>
            ) : (
              <p className="statusline" role="status">
                No shots were produced. Try a different premise.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Adjacent entries: live-action adaptation (consent-gated) and the upload-master handoff. */}
      <div className="create-entries" data-testid="create-entries">
        <div className="entrycard" data-testid="create-liveaction">
          <div className="ey rose">Live action</div>
          <h3>AI live-action adaptation</h3>
          <p className="muted">
            Repurpose existing footage into adaptive cuts. This path is consent-gated: it needs a signed
            likeness release before any face or voice can be reused.
          </p>
          <div className="note" style={{ marginTop: 8 }}>
            <span className="notetag">CONSENT GATE</span>
            Built, not live. The likeness and consent flow must be completed and approved first.
          </div>
          <button
            type="button"
            className="btn"
            disabled
            aria-disabled
            data-testid="create-liveaction-cta"
            title="Available once the consent and likeness flow is live"
          >
            Start adaptation (consent required)
          </button>
        </div>

        <div className="entrycard" data-testid="create-upload-entry">
          <div className="ey rose">Bring your own</div>
          <h3>Upload a master</h3>
          <p className="muted">
            Already have a 9:16 master? Drop it in Upload and we encode it to HLS and register it on a beat.
          </p>
          <button
            type="button"
            className="btn pri"
            onClick={() => onNavigate("upload")}
            data-testid="create-goto-upload"
          >
            Go to Upload
          </button>
        </div>
      </div>

      <div className="note">
        <span className="notetag">SIGNED AND LABELED</span>
        Everything the showrunner generates is C2PA-signed and carries an Article 50 transparency label by
        construction. You will see that label on every produced artifact before you publish.
      </div>
    </div>
  );
}
