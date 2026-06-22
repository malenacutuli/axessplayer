// Prompt 28 reading routes: the HTTP surface over the reading store (works, chapters, demand, adapt,
// candidates, reading-state). Driven through the real Hono app with an in-memory ReadingStore; the content
// DB is unused by these routes. No network. No em dashes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createContentApp } from "../src/http/app.js";
import type { ContentDB } from "../src/content.js";
import type { ReadingStore, CandidateRow, WorkDetail } from "../src/reading-service.js";
import type { ChapterRow, DemandSignals, DemandVerdict, GraduationPlan, WorkRow } from "../src/reading.js";

// A minimal in-memory store: enough to exercise every route end to end.
class MemStore implements ReadingStore {
  works = new Map<string, { row: WorkRow & { status: string; synopsis?: string }; chapters: Map<number, Record<string, unknown>>; candidate?: { demand_score: number; status: string; signals: Record<string, unknown>; linked_series_id: string | null } }>();
  seq = 0;
  signals: DemandSignals = { nReaders: 200, completion: 0.8, rereadRate: 0.5, shareRate: 0.4, finishVelocity: 0.7 };
  async createWork(input: { title: string }) {
    const id = `work-${++this.seq}`;
    this.works.set(id, { row: { id, title: input.title, genre: null, base_language: "en", available_languages: ["en"], cover_url: null, consent_ref: "c-1", provenance_id: "p-1", status: "draft" }, chapters: new Map() });
    return { id };
  }
  async addChapter(workId: string, input: { index: number; title?: string }) {
    this.works.get(workId)!.chapters.set(input.index, { index: input.index, title: input.title ?? null });
    return { id: `ch-${workId}-${input.index}` };
  }
  async publishWork(workId: string) { this.works.get(workId)!.row.status = "published"; }
  async getWork(workId: string): Promise<WorkRow | null> { return this.works.get(workId)?.row ?? null; }
  async getWorkDetail(workId: string): Promise<WorkDetail | null> {
    const w = this.works.get(workId);
    return w ? { work: w.row as unknown as Record<string, unknown>, chapters: [...w.chapters.values()].sort((a, b) => (a.index as number) - (b.index as number)) } : null;
  }
  async listChapters(workId: string): Promise<ChapterRow[]> {
    return [...(this.works.get(workId)?.chapters.values() ?? [])].map((c) => ({ index: c.index as number, title: (c.title as string) ?? null })).sort((a, b) => a.index - b.index);
  }
  async upsertReadingState() {}
  async demandSignals() { return this.signals; }
  async upsertCandidate(workId: string, v: DemandVerdict, s: DemandSignals) { this.works.get(workId)!.candidate = { demand_score: v.demandScore, status: v.status, signals: { ...s }, linked_series_id: null }; }
  async candidateStatus(workId: string) { return this.works.get(workId)?.candidate?.status ?? null; }
  async listCandidates(status?: string): Promise<CandidateRow[]> {
    const out: CandidateRow[] = [];
    for (const [id, w] of this.works) if (w.candidate && (!status || w.candidate.status === status)) out.push({ work_id: id, title: w.row.title, demand_score: w.candidate.demand_score, status: w.candidate.status, signals: w.candidate.signals, linked_series_id: w.candidate.linked_series_id });
    return out;
  }
  async seedSeriesFromPlan(_plan: GraduationPlan) { return { seriesId: `series-${++this.seq}` }; }
  async linkGraduated(workId: string, seriesId: string) { const w = this.works.get(workId)!; w.candidate = { ...(w.candidate ?? { demand_score: 0, signals: {} }), status: "adapting", linked_series_id: seriesId } as never; }
}

function appWith(store: ReadingStore) {
  return createContentApp({ db: {} as unknown as ContentDB, reading: store });
}
const TOKEN = "Bearer session:2a000000-0000-0000-0000-0000000000c0";
function req(app: ReturnType<typeof appWith>, method: string, path: string, body?: unknown, auth?: string) {
  return app.fetch(new Request(`http://content.test${path}`, { method, headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
}

test("the full reading flow over HTTP: create -> chapters -> recompute demand -> adapt", async () => {
  const app = appWith(new MemStore());
  const created = await req(app, "POST", "/works", { title: "Rainfall Hearts", genre: "romance" });
  assert.equal(created.status, 201);
  const { id } = (await created.json()) as { id: string };

  for (const i of [1, 2, 3]) {
    const r = await req(app, "POST", `/works/${id}/chapters`, { index: i, title: `Chapter ${i}`, is_free: i === 1 });
    assert.equal(r.status, 201);
  }
  assert.equal((await req(app, "POST", `/works/${id}/publish`)).status, 200);

  const detail = (await (await req(app, "GET", `/works/${id}`)).json()) as { chapters: unknown[] };
  assert.equal(detail.chapters.length, 3);

  // demand sensor: strong signals -> ready_to_adapt
  const demand = (await (await req(app, "POST", `/works/${id}/recompute-demand`)).json()) as { verdict: { status: string } };
  assert.equal(demand.verdict.status, "ready_to_adapt");

  // it now shows on the ready_to_adapt dashboard
  const dash = (await (await req(app, "GET", `/reading/candidates?status=ready_to_adapt`)).json()) as Array<{ work_id: string }>;
  assert.ok(dash.some((d) => d.work_id === id));

  // adapt to series: graduates into a video series with one beat per chapter
  const adapt = await req(app, "POST", `/works/${id}/adapt`);
  assert.equal(adapt.status, 200);
  const res = (await adapt.json()) as { seriesId: string; beats: number; consentRef: string };
  assert.equal(res.beats, 3);
  assert.equal(res.consentRef, "c-1");
});

test("validation + auth: empty title 400, unknown work 404, adapt-unready 409, reading-state needs a session", async () => {
  const store = new MemStore();
  const app = appWith(store);
  assert.equal((await req(app, "POST", "/works", { title: "" })).status, 400);
  assert.equal((await req(app, "GET", "/works/nope")).status, 404);
  // a work that has not been scored ready cannot be adapted (409)
  const { id } = (await (await req(app, "POST", "/works", { title: "Untested" })).json()) as { id: string };
  await req(app, "POST", `/works/${id}/chapters`, { index: 1 });
  assert.equal((await req(app, "POST", `/works/${id}/adapt`)).status, 409);
  // force overrides and graduates
  assert.equal((await req(app, "POST", `/works/${id}/adapt`, { force: true })).status, 200);
  // reading-state requires a session bearer
  assert.equal((await req(app, "PUT", `/works/${id}/reading-state`, { chapterIndex: 2, percent: 0.5 })).status, 401);
  assert.equal((await req(app, "PUT", `/works/${id}/reading-state`, { chapterIndex: 2, percent: 0.5 }, TOKEN)).status, 200);
});

test("the reading routes are absent (404) when no store is wired", async () => {
  const app = createContentApp({ db: {} as unknown as ContentDB }); // no reading store
  assert.equal((await req(app, "POST", "/works", { title: "x" })).status, 404);
});

test("GET /read/:id serves an accessibility-first reader HTML page", async () => {
  const app = appWith(new MemStore());
  const res = await req(app, "GET", "/read/work-1");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") || "", /text\/html/);
  const html = await res.text();
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /dyslexia/i, "dyslexia-friendly font control present");
  assert.match(html, /aria-live/, "screen-reader live region present");
  assert.match(html, /\/works\/" \+ encodeURIComponent\(WORK_ID\)|works\//, "fetches the work data client-side");
  assert.ok(html.includes("work-1"), "the work id is injected");
});
