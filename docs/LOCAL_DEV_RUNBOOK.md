# Local dev runbook (full stack, real browser)

How to bring the demo up from a cold machine so the reproducibility gate passes
(upload, publish, vertical player with real video, Captions with Intention). No em dashes.

## Prerequisites
- Docker Desktop running, ffmpeg on PATH, Node 20 (`.nvmrc`), pnpm 9.
- `pnpm install` at the repo root.

## 1. Postgres (local, Docker)
The four services talk raw Postgres over `DATABASE_URL`. We run a throwaway local DB.
Host port 5432 is often taken by other projects, so we map to 5433.

```bash
docker run -d --name axess-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=axessplayer -p 5433:5432 postgres:15
# wait until ready, then apply schema + seed
for f in supabase/migrations/000{1,2,3,4,5,6,7,8}_*.sql; do
  docker exec -i axess-pg psql -v ON_ERROR_STOP=1 -U postgres -d axessplayer < "$f"
done
docker exec -i axess-pg psql -U postgres -d axessplayer < supabase/seed.sql
```
Seed creates series `11111111-1111-1111-1111-111111111111` ("The Last Signal") and
users `aaaaaaaa-0000-0000-0000-000000000001/2` with wallets.

## 2. Services (each its own process)
```bash
export DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5433/axessplayer
PORT=8091 DATABASE_URL="$DATABASE_URL" pnpm --filter @axessplayer/economy  serve &
PORT=8092 DATABASE_URL="$DATABASE_URL" pnpm --filter @axessplayer/decision serve &
PORT=8093 DATABASE_URL="$DATABASE_URL" pnpm --filter @axessplayer/content  serve &
PORT=8094                              pnpm --filter @axessplayer/manifest serve &
node tools/media-server/server.mjs &   # 8095, real ffmpeg HLS ingest + serving
```

## 3. Web app env (`apps/web/.env.local`, gitignored)
Base URLs MUST be empty so the Vite proxy (vite.config.ts) routes by path prefix to
the services. The session bearer MUST be `session:<seeded-user-uuid>` (the test
verifier in `services/economy/src/http/auth.ts` matches `^session:(.+)$` and requires
a UUID). `VITE_SCENE_VIDEO_URL` points the player surface at a real HLS master.
```
VITE_CONTENT_BASE_URL=
VITE_ECONOMY_BASE_URL=
VITE_DECISION_BASE_URL=
VITE_MANIFEST_BASE_URL=
VITE_SESSION_TOKEN=session:aaaaaaaa-0000-0000-0000-000000000001
VITE_SCENE_VIDEO_URL=http://127.0.0.1:8095/media/<uploaded-id>/master.m3u8
```

## 4. Dev servers
```bash
cd apps/web    && pnpm dev               # http://localhost:5173
cd apps/studio && pnpm dev -- --port 5174 # http://localhost:5174 (both apps are bare vite -> force the port)
```

## 5. Get a real video into the player
Upload via Studio (Media & variants -> drop a 9:16 mp4 -> Upload and encode), which
PUTs to the media-server, runs ffmpeg to HLS, and registers a variant. To make the
consumer player and Captions with Intention show a real clip, set the cold-open
variant's `playback_url` and `caption_doc_url` to a media-server URL, e.g.:
```sql
update beat_variants set playback_url='http://127.0.0.1:8095/media/<id>/master.m3u8',
                         caption_doc_url='http://127.0.0.1:8095/media/<id>/captions.json';
```
Then publish the series in Studio (Publish -> Publish to feed).

## Gotchas
- `localhost` resolves to IPv6 here; vite binds `::1`. Use `localhost`, not `127.0.0.1`, against the dev servers.
- The consumer player plays HLS via hls.js (`apps/web/src/player/hls.ts`); a plain `.m3u8` works in Chromium.
- The Studio poster generator needs `VITE_AXESSIBLE_POSTER_ENDPOINT` + `VITE_AXESSIBLE_ANON_KEY`; without them it renders but the Generate button is disabled.
- This local DB is throwaway. It is NOT the hosted Supabase `faeyekynudyzeotbjfsj` (that is the Axessible/mvpsigndemo product DB and has no series/beat_variants schema).
