// Series ownership for the creator platform. Every content write resolves the series it touches (directly,
// or through an episode, beat, or variant) and is allowed only for that series' owner. Drafts are private to
// their owner; published series are public to read. One implementation over a pg-shaped query function, so
// production (node-postgres) and the test harness (PGlite) run the same SQL. No em dashes.

export type Query = (sql: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

export interface SeriesAccess {
  seriesId: string;
  ownerId: string | null;
  published: boolean;
}

export interface Ownership {
  ofSeries(id: string): Promise<SeriesAccess | null>;
  ofEpisode(id: string): Promise<SeriesAccess | null>;
  ofBeat(id: string): Promise<SeriesAccess | null>;
  ofVariant(id: string): Promise<SeriesAccess | null>;
  setOwner(seriesId: string, ownerId: string): Promise<void>;
  ownedSeriesIds(ownerId: string): Promise<Set<string>>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function access(row: Record<string, unknown> | undefined): SeriesAccess | null {
  if (!row) return null;
  return {
    seriesId: String(row.series_id),
    ownerId: row.owner_id == null ? null : String(row.owner_id),
    published: row.published === true,
  };
}

export function sqlOwnership(query: Query): Ownership {
  // Malformed ids never reach the database (a non-uuid would be a cast error, i.e. a 500).
  const one = async (sql: string, id: string) => (UUID_RE.test(id) ? access((await query(sql, [id])).rows[0]) : null);
  const cols = "s.id as series_id, s.owner_id, (s.published_at is not null) as published";
  return {
    ofSeries: (id) => one(`select ${cols} from series s where s.id = $1`, id),
    ofEpisode: (id) => one(`select ${cols} from episodes e join series s on s.id = e.series_id where e.id = $1`, id),
    ofBeat: (id) => one(`select ${cols} from beats b join series s on s.id = b.series_id where b.id = $1`, id),
    ofVariant: (id) =>
      one(`select ${cols} from beat_variants v join beats b on b.id = v.beat_id join series s on s.id = b.series_id where v.id = $1`, id),
    async setOwner(seriesId, ownerId) {
      await query("update series set owner_id = $2 where id = $1", [seriesId, ownerId]);
    },
    async ownedSeriesIds(ownerId) {
      const { rows } = await query("select id from series where owner_id = $1", [ownerId]);
      return new Set(rows.map((r) => String(r.id)));
    },
  };
}
