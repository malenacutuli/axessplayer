# W2a Economy HTTP adapter agent brief

**Mission.** Make the already-built, already-hardened economy handlers actually serve over HTTP. The
business logic is done and proven; this is the thin transport and auth layer in front of it. Merge this
early, because it unblocks any workstream that needs to call the economy for real. No em dashes.

**Branch.** `w2a-economy-http`, off main. Merge by PR with orchestrator sign-off.

**Owns.** `services/economy/src/http/**` (new), `services/economy/test/http.test.ts`. Do NOT modify the
existing handlers, RPCs, or migrations; wrap them.

**Consumes (read-only).**
- `contracts/api/economy.yaml` (frozen, 0.3.2): the routes, the `sessionAuth` vs `serviceAuth` split,
  the request/response shapes, the 401/403/402/404 codes.
- The existing `services/economy/src/economy.ts` handlers (`handleGetWallet`, `handleSpend`,
  `handleGrant`) and `pgEconomyDb`.

**Must not touch.** The economy handlers, `spend_coins`/`grant_coins`, `contracts/`, `supabase/`.

**Build.**
1. Pick a framework (recommended: Hono, tiny and edge-friendly and TypeScript-native) and wire three
   routes to the three handlers.
2. **Enforce the F1 trust boundary at the edge:** `/wallet` and `/spend` resolve the acting user from
   the session token and pass it as the handler's `userId`; the body has no `user_id` (per 0.3.2).
   `/grant` requires the service role and is rejected with 403 otherwise.
3. Run the DB access as the service role (only `service_role` may execute the RPCs, per 0003/0004).
4. Map handler results to HTTP responses verbatim (the handlers already return `{status, body}`).

**Definition of done.** Typecheck + lint clean; tests green; FULL `pnpm test` green. The routes match
`economy.yaml` exactly. A test proves a client token cannot reach `/grant` and cannot put a `user_id`
in a `/spend` body (there is no such field).

**Tests.** Route tests with a fake/seeded DB: `/wallet` self-scopes to the token subject; `/spend`
maps insufficient funds to 402; `/grant` returns 403 without the service role. `node:test` + tsx.

**Flag, do not fake.** Real token verification (JWT/JWKS) can be a clear interface with a test verifier
for now; say so. Do not ship a route that skips the service-role check on `/grant`.
