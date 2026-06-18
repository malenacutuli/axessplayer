# @axessplayer/admin-api (slice B)

NEW, undeployed operator/admin API. NOT in render.yaml; NOT one of the 5 live services. Read-only wave.

Implements the ADMIN API CONTRACT against the hosted `mobile` schema:
- GET /admin/me            -> { operator, role }
- GET /admin/dashboard     -> { kpis[], topSeries[], policy } aggregating real hosted data
- GET /admin/content       -> the entity tree (channels -> series -> episodes) + a11y rollups + status
- GET /admin/content/:id   -> single-series detail (episodes, beats, variants)

Shape mirrors content/decision: node:http on 0.0.0.0/PORT 8102, pg with search_path=mobile via DB_OPTIONS,
NODE_ENV=production is a hard-throw cutover gate (refuses the TEST operator verifier).

Layers:
- auth.ts    operator Bearer verifier stub (operator:<role>:<id>); real MFA/JWKS is a cutover gate.
- rbac.ts    (role, route, method) -> allow/deny for the 8 roles. ReadOnly may GET, not mutate. Deny is default.
- audit.ts   AdminAuditSink interface + PgAuditSink (mobile.admin_audit_log) + InMemory stub. Append-only seam.
- queries.ts pure SQL builders ({text, values}), unit-tested with a fake pg.
- aggregate.ts folds rows into the contract DTOs.
- http/app.ts thin Hono adapter: authn -> rbac -> (audit seam) -> delegate.

HARD GATE: reward-function weights are DISPLAY-ONLY. The dashboard returns a policy_version string and
rewardWeightsEditable:false; no route reads or writes a weight. A weight change is a founder sign-off.

Additive DDL: scripts/sql/07_admin_audit.sql (append-only mobile.admin_audit_log). NOT executed by this
service; the main loop / a human applies it.
