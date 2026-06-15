// Authoring forms over the content service create endpoints. Each form gathers the column-derived payload
// (mirrored body types from contractGap.ts), posts via the ContentClient, surfaces the 201 id or the 400
// error, and signals the page to reload the graph.
//
// CONTRACT GAP: request bodies are validated SERVER-SIDE by the content service (enums, intensity 1..5,
// non-negative coin_cost, composite-FK). The forms do light client-side shaping (number parsing, optional
// fields) but the server is the authority. When content.yaml gains request-body schemas, tighten the
// client-side validation to the codegen request types and drop the contractGap import.
//
// F1 GUARDRAIL: no form field is `user_id` and no body assembled here contains one. No em dashes.
import { useState, type FormEvent } from "react";
import { useContentClient } from "../api/useContentClient.js";
import { ContentApiError } from "../api/client.js";
import {
  BEAT_ROLES,
  VARIANT_TIERS,
  QA_STATUSES,
  type BeatRole,
  type VariantTier,
  type QaStatus,
  type CreateSeriesBody,
  type CreateEpisodeBody,
  type CreateBeatBody,
  type CreateVariantBody,
  type CreateEdgeBody,
} from "../api/contractGap.js";

export interface AuthoringFormsProps {
  // The series the author is editing. Episode and beat forms scope to it.
  seriesId: string;
  // Beat ids available in the loaded graph, for the variant and edge forms.
  episodeOptions: Array<{ id: string; label: string }>;
  beatOptions: Array<{ id: string; label: string }>;
  // Called after any successful create so the page can reload the graph.
  onCreated: (kind: string, id: string) => void;
  // Called when a series is created so the page can adopt the new id.
  onSeriesCreated: (id: string) => void;
}

type Status =
  | { state: "idle" }
  | { state: "submitting" }
  | { state: "ok"; message: string }
  | { state: "error"; message: string };

function useSubmit() {
  const [status, setStatus] = useState<Status>({ state: "idle" });
  const run = async (fn: () => Promise<string>, okPrefix: string) => {
    setStatus({ state: "submitting" });
    try {
      const id = await fn();
      setStatus({ state: "ok", message: `${okPrefix} ${id}` });
      return id;
    } catch (e) {
      const message =
        e instanceof ContentApiError
          ? (e.apiError ?? `error_${e.status}`)
          : e instanceof Error
            ? e.message
            : "request_failed";
      setStatus({ state: "error", message });
      return null;
    }
  };
  return { status, run };
}

function StatusLine({ status, testid }: { status: Status; testid: string }): JSX.Element | null {
  if (status.state === "ok") {
    return (
      <p data-testid={`${testid}-ok`} role="status">
        Created {status.message}
      </p>
    );
  }
  if (status.state === "error") {
    return (
      <p data-testid={`${testid}-error`} role="alert">
        Error: {status.message}
      </p>
    );
  }
  return null;
}

export function CreateSeriesForm({
  onSeriesCreated,
}: Pick<AuthoringFormsProps, "onSeriesCreated">): JSX.Element {
  const client = useContentClient();
  const { status, run } = useSubmit();
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState("");
  const [baseLanguage, setBaseLanguage] = useState("en");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const body: CreateSeriesBody = {
      title: title.trim(),
      genre: genre.trim() === "" ? null : genre.trim(),
      base_language: baseLanguage.trim() === "" ? undefined : baseLanguage.trim(),
    };
    const id = await run(async () => (await client.createSeries(body)).id, "series");
    if (id) onSeriesCreated(id);
  };

  return (
    <form aria-label="Create series" onSubmit={onSubmit} data-testid="form-series">
      <h3>New series</h3>
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} required />
      </label>
      <label>
        Genre
        <input value={genre} onChange={(e) => setGenre(e.target.value)} />
      </label>
      <label>
        Base language
        <input value={baseLanguage} onChange={(e) => setBaseLanguage(e.target.value)} />
      </label>
      <button type="submit" disabled={status.state === "submitting"}>
        Create series
      </button>
      <StatusLine status={status} testid="form-series" />
    </form>
  );
}

export function CreateEpisodeForm({
  seriesId,
  onCreated,
}: Pick<AuthoringFormsProps, "seriesId" | "onCreated">): JSX.Element {
  const client = useContentClient();
  const { status, run } = useSubmit();
  const [episodeNumber, setEpisodeNumber] = useState("1");
  const [title, setTitle] = useState("");
  const [isFree, setIsFree] = useState(true);
  const [coinCost, setCoinCost] = useState("0");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const body: CreateEpisodeBody = {
      series_id: seriesId,
      episode_number: Number.parseInt(episodeNumber, 10),
      title: title.trim() === "" ? null : title.trim(),
      is_free: isFree,
      coin_cost: Number.parseInt(coinCost, 10) || 0,
    };
    const id = await run(async () => (await client.createEpisode(body)).id, "episode");
    if (id) onCreated("episode", id);
  };

  return (
    <form aria-label="Create episode" onSubmit={onSubmit} data-testid="form-episode">
      <h3>New episode</h3>
      <label>
        Episode number
        <input
          type="number"
          value={episodeNumber}
          onChange={(e) => setEpisodeNumber(e.target.value)}
          required
        />
      </label>
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Free
        <input type="checkbox" checked={isFree} onChange={(e) => setIsFree(e.target.checked)} />
      </label>
      <label>
        Coin cost
        <input type="number" value={coinCost} onChange={(e) => setCoinCost(e.target.value)} />
      </label>
      <button type="submit" disabled={status.state === "submitting" || !seriesId}>
        Create episode
      </button>
      <StatusLine status={status} testid="form-episode" />
    </form>
  );
}

export function CreateBeatForm({
  seriesId,
  episodeOptions,
  onCreated,
}: Pick<AuthoringFormsProps, "seriesId" | "episodeOptions" | "onCreated">): JSX.Element {
  const client = useContentClient();
  const { status, run } = useSubmit();
  const [episodeId, setEpisodeId] = useState("");
  const [beatIndex, setBeatIndex] = useState("0");
  const [role, setRole] = useState<BeatRole>("spine");
  const [isBranchPoint, setIsBranchPoint] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const body: CreateBeatBody = {
      series_id: seriesId,
      episode_id: episodeId,
      beat_index: Number.parseInt(beatIndex, 10) || 0,
      role,
      is_branch_point: isBranchPoint,
    };
    const id = await run(async () => (await client.createBeat(body)).id, "beat");
    if (id) onCreated("beat", id);
  };

  return (
    <form aria-label="Create beat" onSubmit={onSubmit} data-testid="form-beat">
      <h3>New beat</h3>
      <label>
        Episode
        <select value={episodeId} onChange={(e) => setEpisodeId(e.target.value)} required>
          <option value="">Select episode</option>
          {episodeOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Beat index
        <input type="number" value={beatIndex} onChange={(e) => setBeatIndex(e.target.value)} />
      </label>
      <label>
        Role
        <select value={role} onChange={(e) => setRole(e.target.value as BeatRole)}>
          {BEAT_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </label>
      <label>
        Branch point
        <input
          type="checkbox"
          checked={isBranchPoint}
          onChange={(e) => setIsBranchPoint(e.target.checked)}
        />
      </label>
      <button type="submit" disabled={status.state === "submitting" || !seriesId || !episodeId}>
        Create beat
      </button>
      <StatusLine status={status} testid="form-beat" />
    </form>
  );
}

export function CreateVariantForm({
  beatOptions,
  onCreated,
}: Pick<AuthoringFormsProps, "beatOptions" | "onCreated">): JSX.Element {
  const client = useContentClient();
  const { status, run } = useSubmit();
  const [beatId, setBeatId] = useState("");
  const [language, setLanguage] = useState("en");
  const [tier, setTier] = useState<VariantTier>("A_filmed");
  const [intensity, setIntensity] = useState("3");
  const [isPremium, setIsPremium] = useState(false);
  const [coinCost, setCoinCost] = useState("0");
  const [playbackUrl, setPlaybackUrl] = useState("");
  const [qaStatus, setQaStatus] = useState<QaStatus>("pending");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const body: CreateVariantBody = {
      beat_id: beatId,
      language: language.trim() === "" ? undefined : language.trim(),
      tier,
      intensity: Number.parseInt(intensity, 10),
      is_premium: isPremium,
      coin_cost: Number.parseInt(coinCost, 10) || 0,
      playback_url: playbackUrl.trim(),
      qa_status: qaStatus,
    };
    const id = await run(async () => (await client.createVariant(body)).id, "variant");
    if (id) onCreated("variant", id);
  };

  return (
    <form aria-label="Create variant" onSubmit={onSubmit} data-testid="form-variant">
      <h3>Attach variant</h3>
      <label>
        Beat
        <select value={beatId} onChange={(e) => setBeatId(e.target.value)} required>
          <option value="">Select beat</option>
          {beatOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Language
        <input value={language} onChange={(e) => setLanguage(e.target.value)} />
      </label>
      <label>
        Tier
        <select value={tier} onChange={(e) => setTier(e.target.value as VariantTier)}>
          {VARIANT_TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <label>
        Intensity (1 to 5)
        <input
          type="number"
          min={1}
          max={5}
          value={intensity}
          onChange={(e) => setIntensity(e.target.value)}
        />
      </label>
      <label>
        Premium
        <input type="checkbox" checked={isPremium} onChange={(e) => setIsPremium(e.target.checked)} />
      </label>
      <label>
        Coin cost
        <input type="number" value={coinCost} onChange={(e) => setCoinCost(e.target.value)} />
      </label>
      <label>
        Playback URL
        <input value={playbackUrl} onChange={(e) => setPlaybackUrl(e.target.value)} required />
      </label>
      <label>
        QA status
        <select value={qaStatus} onChange={(e) => setQaStatus(e.target.value as QaStatus)}>
          {QA_STATUSES.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={status.state === "submitting" || !beatId}>
        Attach variant
      </button>
      <StatusLine status={status} testid="form-variant" />
    </form>
  );
}

export function CreateEdgeForm({
  beatOptions,
  onCreated,
}: Pick<AuthoringFormsProps, "beatOptions" | "onCreated">): JSX.Element {
  const client = useContentClient();
  const { status, run } = useSubmit();
  const [fromBeatId, setFromBeatId] = useState("");
  const [toBeatId, setToBeatId] = useState("");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const body: CreateEdgeBody = {
      from_beat_id: fromBeatId,
      to_beat_id: toBeatId,
    };
    const id = await run(async () => {
      const row = await client.createEdge(body);
      return `${row.from_beat_id}->${row.to_beat_id}`;
    }, "edge");
    if (id) onCreated("edge", id);
  };

  return (
    <form aria-label="Draw edge" onSubmit={onSubmit} data-testid="form-edge">
      <h3>Draw edge</h3>
      <label>
        From beat
        <select value={fromBeatId} onChange={(e) => setFromBeatId(e.target.value)} required>
          <option value="">Select beat</option>
          {beatOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        To beat
        <select value={toBeatId} onChange={(e) => setToBeatId(e.target.value)} required>
          <option value="">Select beat</option>
          {beatOptions.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        disabled={status.state === "submitting" || !fromBeatId || !toBeatId}
      >
        Draw edge
      </button>
      <StatusLine status={status} testid="form-edge" />
    </form>
  );
}
