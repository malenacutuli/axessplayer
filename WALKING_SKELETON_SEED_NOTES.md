# Walking-skeleton increment : notes

This is the first end-to-end vertical slice: one series, one episode, a branch at beat 2, a control holdout, and a premium unlock. It proves the adaptive path against real fixtures. No em dashes.

## Files in this increment
- `supabase/seed.sql` : the fixture series and graph (cold open, branch point, calm and tense cuts, shared ending, one premium alternate ending), two users with wallets and seeded viewer_state.
- `services/decision/src/policy.ts` : pure, testable policy. `assignControl` (stable per user) and `chooseBranch` (control gets the director's cut, treatment branches on intensity).
- `services/decision/src/decide.ts` : the `/decide` handler. Returns `decision_id` (PF-2) and `prefetch_variant_ids` (PF-6 client-side branching). DB is injected so it is testable.
- `services/decision/src/decide.test.ts` : vitest unit tests for the policy and the handler.

## Verified (Node logic pass, 10/10)
Control assignment is stable and lands near 10 percent. Control always gets the calm cut. Treatment at intensity 5 gets tense, at intensity 2 gets calm, unknown state falls back to calm. The handler returns the right shape and throws at the end of the graph. In the repo, run `pnpm --filter @axessplayer/decision test` (vitest) for the typed version.

## How it maps to the walking-skeleton acceptance test (04_WALKING_SKELETON.md)
- Cold open seeds viewer_state (the seed sets intensity per user; the live cold open writes it).
- At beat 2, `/decide` returns a variant plus prefetch hints and logs a `decision_log` row with `is_control`.
- The premium ending (`cccccccc-...0005`, cost 5) is unlocked via `spend_coins(user, 'beat_variant', that_id, txn)`. The wallet holds 10, so it deducts once; a repeat with the same `txn` is a no-op.
- Control users receive the director's cut (calm) and `decision_log.is_control` is true.

## Open items and human sign-off
- The decision policy here is a deterministic stand-in. The real policy (contextual bandit, KV-cached viewer vectors, sub-50ms serving) is W3 and requires human design plus sign-off per 05_SECURITY_AND_COMPLIANCE.md.
- `spend_coins` (0002) is still unreviewed ledger code; the premium-unlock step depends on it.
- Control arm is decided by `assignControl` (a hash of the user id), not by the seed labels. The seed user names only describe their seeded intensity. For a deterministic e2e, the W12 harness either forces an arm in the fake DB (as the unit test does) or seeds enough users to land one in each arm.
- `playback_url` values are placeholders. Real seamless playback is the W4 manifest plus the W5 player runtime.
