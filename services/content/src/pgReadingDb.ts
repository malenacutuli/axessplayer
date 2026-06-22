// Postgres adapter for the reading platform (prompt 28). Implements ReadingStore over the same node-postgres
// pool the content service uses, against the additive mobile reading tables (works, chapters, reading_state,
// adaptation_candidates). The demand aggregate + candidate upsert use the SQL builders from reading.ts so the
// scoring shape stays single-sourced. No em dashes.

import type pg from "pg";
import {
  buildDemandSignalsQuery,
  buildUpsertCandidate,
  mapDemandSignals,
  type ChapterRow,
  type DemandSignals,
  type DemandVerdict,
  type GraduationPlan,
  type WorkRow,
} from "./reading.js";
import type { CandidateRow, CreateChapterInput, CreateWorkInput, ReadingStore, WorkCard, WorkDetail } from "./reading-service.js";

type Q = Pick<pg.Pool, "query">;

export class PgReadingDb implements ReadingStore {
  constructor(private readonly db: Q) {}

  async createWork(input: CreateWorkInput): Promise<{ id: string }> {
    const r = await this.db.query(
      `insert into mobile.works
         (title, synopsis, genre, language, base_language, available_languages, author_id, origin, status, consent_ref, provenance_id, ai_assisted)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10,$11) returning id`,
      [
        input.title,
        input.synopsis ?? null,
        input.genre ?? null,
        input.language ?? "en",
        input.base_language ?? input.language ?? "en",
        input.available_languages ?? ["en"],
        input.author_id ?? null,
        input.origin ?? "creator_self_publish",
        input.consent_ref ?? null,
        input.provenance_id ?? null,
        input.ai_assisted ?? false,
      ],
    );
    return { id: (r.rows[0] as { id: string }).id };
  }

  async addChapter(workId: string, input: CreateChapterInput): Promise<{ id: string }> {
    const r = await this.db.query(
      `insert into mobile.chapters (work_id, index, title, body_ref, is_free, coin_cost, accessibility, published_at)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb, now())
       on conflict (work_id, index) do update set
         title = excluded.title, body_ref = excluded.body_ref, is_free = excluded.is_free,
         coin_cost = excluded.coin_cost, accessibility = excluded.accessibility
       returning id`,
      [workId, input.index, input.title ?? null, input.body_ref ?? null, input.is_free ?? false, input.coin_cost ?? 0, JSON.stringify(input.accessibility ?? {})],
    );
    return { id: (r.rows[0] as { id: string }).id };
  }

  async publishWork(workId: string): Promise<void> {
    await this.db.query("update mobile.works set status='published', published_at = coalesce(published_at, now()) where id = $1", [workId]);
  }

  async getWork(workId: string): Promise<WorkRow | null> {
    const r = await this.db.query(
      `select id, title, genre, base_language, available_languages, cover_url, consent_ref, provenance_id from mobile.works where id = $1`,
      [workId],
    );
    return (r.rows[0] as WorkRow | undefined) ?? null;
  }

  async getWorkDetail(workId: string): Promise<WorkDetail | null> {
    const w = await this.db.query(`select * from mobile.works where id = $1`, [workId]);
    if (w.rows.length === 0) return null;
    const c = await this.db.query(
      `select index, title, body_ref, is_free, coin_cost, accessibility, published_at from mobile.chapters where work_id = $1 order by index asc`,
      [workId],
    );
    return { work: w.rows[0] as Record<string, unknown>, chapters: c.rows as Record<string, unknown>[] };
  }

  async listChapters(workId: string): Promise<ChapterRow[]> {
    const r = await this.db.query(`select index, title from mobile.chapters where work_id = $1 order by index asc`, [workId]);
    return r.rows as ChapterRow[];
  }

  async upsertReadingState(userId: string, workId: string, chapterIndex: number, percent: number): Promise<void> {
    await this.db.query(
      `insert into mobile.reading_state (user_id, work_id, chapter_index, percent, updated_at)
       values ($1,$2,$3,$4, now())
       on conflict (user_id, work_id) do update set chapter_index = excluded.chapter_index, percent = excluded.percent, updated_at = now()`,
      [userId, workId, chapterIndex, percent],
    );
  }

  async demandSignals(workId: string): Promise<DemandSignals> {
    const q = buildDemandSignalsQuery();
    const r = await this.db.query(q.text, q.params(workId));
    return mapDemandSignals((r.rows[0] as Record<string, unknown>) ?? {});
  }

  async upsertCandidate(workId: string, verdict: DemandVerdict, signals: DemandSignals): Promise<void> {
    const u = buildUpsertCandidate();
    await this.db.query(u.text, u.params(workId, verdict, signals));
  }

  async candidateStatus(workId: string): Promise<string | null> {
    const r = await this.db.query(`select status from mobile.adaptation_candidates where work_id = $1`, [workId]);
    return (r.rows[0] as { status?: string } | undefined)?.status ?? null;
  }

  async listPublishedWorks(): Promise<WorkCard[]> {
    const r = await this.db.query(
      `select w.id, w.title, w.synopsis, w.genre, w.cover_url,
              (select count(*) from mobile.chapters c where c.work_id = w.id) as chapters,
              (select count(*) from mobile.chapters c where c.work_id = w.id and c.is_free) as free_chapters
         from mobile.works w
        where w.status = 'published'
        order by w.published_at desc nulls last`,
    );
    return r.rows.map((x) => {
      const o = x as Record<string, unknown>;
      return {
        id: o.id as string,
        title: o.title as string,
        synopsis: (o.synopsis as string) ?? null,
        genre: (o.genre as string) ?? null,
        cover_url: (o.cover_url as string) ?? null,
        chapters: Number(o.chapters ?? 0),
        free_chapters: Number(o.free_chapters ?? 0),
      };
    });
  }

  async listCandidates(status?: string): Promise<CandidateRow[]> {
    const r = status
      ? await this.db.query(
          `select ac.work_id, w.title, ac.demand_score, ac.status, ac.signals, ac.linked_series_id
             from mobile.adaptation_candidates ac join mobile.works w on w.id = ac.work_id
            where ac.status = $1 order by ac.demand_score desc`,
          [status],
        )
      : await this.db.query(
          `select ac.work_id, w.title, ac.demand_score, ac.status, ac.signals, ac.linked_series_id
             from mobile.adaptation_candidates ac join mobile.works w on w.id = ac.work_id
            order by ac.demand_score desc`,
        );
    return r.rows as CandidateRow[];
  }

  // Seed series -> episode 1 -> one beat per chapter from the graduation plan. Carries the source work's
  // consent + provenance into the series poster_provenance so the adapted video is traceably licensed.
  async seedSeriesFromPlan(plan: GraduationPlan): Promise<{ seriesId: string }> {
    const s = await this.db.query(
      `insert into mobile.series (title, genre, base_language, available_languages, cover_url, format, poster_provenance, published_at)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb, now()) returning id`,
      [
        plan.series.title,
        plan.series.genre,
        plan.series.base_language,
        plan.series.available_languages,
        plan.series.cover_url,
        plan.series.format,
        JSON.stringify({ adapted_from: "reading", consent_ref: plan.consentRef, provenance_id: plan.provenanceId }),
      ],
    );
    const seriesId = (s.rows[0] as { id: string }).id;
    const ep = await this.db.query(
      `insert into mobile.episodes (series_id, episode_number, title, is_free, coin_cost, published_at) values ($1,$2,$3,$4,$5, now()) returning id`,
      [seriesId, plan.episode.episode_number, plan.episode.title, plan.episode.is_free, plan.episode.coin_cost],
    );
    const episodeId = (ep.rows[0] as { id: string }).id;
    for (const b of plan.beats) {
      await this.db.query(
        `insert into mobile.beats (series_id, episode_id, beat_index, role, canon_facts) values ($1,$2,$3,$4,$5::jsonb)`,
        [seriesId, episodeId, b.beat_index, b.role, JSON.stringify(b.canon_facts)],
      );
    }
    return { seriesId };
  }

  async linkGraduated(workId: string, seriesId: string): Promise<void> {
    await this.db.query(
      `update mobile.adaptation_candidates set linked_series_id = $2, status = 'adapting', updated_at = now() where work_id = $1`,
      [workId, seriesId],
    );
  }
}
