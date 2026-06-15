// The feed's view model over the content graph. The frozen content contract documents
// GET /series/{id}/graph but not its 200 schema (content?: never in the codegen), so the response body
// is parsed DEFENSIVELY here into the shape the feed and the player need, tolerating missing optional
// fields rather than trusting an untyped payload. This is the seam where a future content-contract patch
// that types the graph would replace these guards with codegen types. No em dashes.

// One playable variant of a beat: a language + accessibility-tagged cut. The feed and player select
// among these by the viewer's accessibility preferences (see src/accessibility/select.ts).
export interface VariantNode {
  id: string;
  // BCP-47-ish language tag, e.g. "en", "es". Optional in older fixtures.
  language?: string;
  // Accessibility affordances this cut provides. Absent flags mean "not provided by this variant".
  captions?: boolean;
  audioDescription?: boolean;
  sign?: boolean;
  // Monetization. is_premium gates the cut behind /spend (beat_variant scope).
  isPremium?: boolean;
  coinCost?: number;
}

// One beat (a node in the branching graph). The cold-open beat is the one the player starts on.
export interface BeatNode {
  id: string;
  isColdOpen?: boolean;
  variants: VariantNode[];
}

// One episode in a series: ordered, optionally free or coin-gated at the episode scope.
export interface EpisodeNode {
  id: string;
  episodeNumber: number;
  title?: string;
  isFree?: boolean;
  coinCost?: number;
  // The beat the episode opens on (drives the player's startBeatId).
  coldOpenBeatId?: string;
  beats: BeatNode[];
}

// A series resolved into its episodes. This is what one feed card and its player are built from.
export interface SeriesGraph {
  id: string;
  title?: string;
  episodes: EpisodeNode[];
}

// Parse the raw GET /series/{id}/graph json into the view model. Unknown / missing fields degrade to
// sensible defaults; a structurally invalid payload (not an object, no id) throws so the feed surfaces a
// load error rather than rendering an empty card silently.
export function parseSeriesGraph(seriesId: string, raw: unknown): SeriesGraph {
  if (!isRecord(raw)) {
    throw new Error(`series graph for ${seriesId} is not an object`);
  }
  const id = str(raw.id) ?? seriesId;
  const episodesRaw = Array.isArray(raw.episodes) ? raw.episodes : [];
  const episodes = episodesRaw
    .filter(isRecord)
    .map((e, i) => parseEpisode(e, i))
    .sort((a, b) => a.episodeNumber - b.episodeNumber);
  return { id, title: str(raw.title), episodes };
}

function parseEpisode(raw: Record<string, unknown>, index: number): EpisodeNode {
  const beatsRaw = Array.isArray(raw.beats) ? raw.beats : [];
  const beats = beatsRaw.filter(isRecord).map(parseBeat);
  const coldOpen = beats.find((b) => b.isColdOpen) ?? beats[0];
  return {
    id: str(raw.id) ?? `episode-${index}`,
    episodeNumber: num(raw.episode_number) ?? index + 1,
    title: str(raw.title),
    isFree: bool(raw.is_free),
    coinCost: num(raw.coin_cost),
    coldOpenBeatId: str(raw.cold_open_beat_id) ?? coldOpen?.id,
    beats,
  };
}

function parseBeat(raw: Record<string, unknown>): BeatNode {
  const variantsRaw = Array.isArray(raw.variants) ? raw.variants : [];
  return {
    id: str(raw.id) ?? "",
    isColdOpen: bool(raw.is_cold_open),
    variants: variantsRaw.filter(isRecord).map(parseVariant),
  };
}

function parseVariant(raw: Record<string, unknown>): VariantNode {
  const a11y = isRecord(raw.accessibility) ? raw.accessibility : raw;
  return {
    id: str(raw.id) ?? "",
    language: str(raw.language),
    captions: bool(a11y.captions),
    audioDescription: bool(a11y.audio_description) ?? bool(a11y.audioDescription),
    sign: bool(a11y.sign),
    isPremium: bool(raw.is_premium),
    coinCost: num(raw.coin_cost),
  };
}

// ---- defensive coercers ----

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function bool(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}
