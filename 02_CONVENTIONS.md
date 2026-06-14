# Conventions

## Languages and stacks
- Services: TypeScript on Node or Deno edge functions, except `decision` (Python or Rust for the policy) and `manifest` (edge worker). Justify any deviation in the package README.
- Mobile: React Native (Expo). Studio: React + Vite (extends Axessible).
- Database: PostgreSQL via Supabase. KV: Redis or Cloudflare KV.
- Package manager: pnpm. Monorepo: turborepo.

## Git
- One branch per workstream, named by id (`w3-decision`). Work in a dedicated git worktree.
- Conventional commits, scoped by package: `decision: add LinUCB policy`.
- Pull requests into `main`, small and reviewable. Link the brief's Definition of Done items.
- No direct commits to `main`. No edits to `contracts/` outside W0.

## Testing
- Unit tests beside the code. Coverage gate: 80 percent on services with business logic.
- Contract tests: every service validates requests and responses against the OpenAPI spec.
- The economy package includes a concurrency suite (thousands of simultaneous spends on one wallet).
- The decision and manifest packages include latency-budget tests.
- End-to-end tests live in the QA package and include the walking skeleton.

## CI gates (must pass before merge)
1. typecheck against generated contract clients
2. lint and format
3. unit tests with coverage gate
4. contract validation
5. package-specific suites: ledger concurrency (W2), latency budget (W3, W4), e2e (W12)

## Error handling and resilience
- Playback must never block on a decision. On timeout or error, fall back to the director's cut.
- All external calls (models, IAP, ads) are retried with backoff and have a circuit breaker.
- Every mutation carries a client transaction id and is idempotent.

## Observability
- Structured logs with a trace id propagated app to decision to manifest to CDN.
- Metrics: decision latency p99, manifest compose time, ledger write latency, cache-hit ratio.
- Emit the events defined in `contracts/events/events.md` for every meaningful action.

## Security
- Row Level Security on every table. Server-side authorization on every mutation.
- Secrets in environment or a vault, never in code or commits.
- The ledger and trust layer require a security-review subagent pass plus human sign-off.
