# Increment : make services/decision a real, runnable package

This turns the `services/decision` echo-stub into a runnable TypeScript test package, so the walking-skeleton suite actually executes (fixing the earlier hollow "run pnpm test" instruction). No em dashes.

## Files in this increment
- `services/decision/package.json` : real package `@axessplayer/decision`. Scripts: `typecheck` (tsc), `test` (node --test via tsx), `build` (tsc), `lint`. Dev deps: typescript, tsx, @types/node.
- `services/decision/tsconfig.json` : extends the root base, overrides to `NodeNext` module and resolution so the `.js` import specifiers typecheck.
- `services/decision/src/decide.test.ts` : REPLACES the prior vitest version. Same assertions, rewritten to `node:test` + `node:assert`, so it runs with zero esbuild/vitest config and on the CI-pinned Node 20 via tsx.

`policy.ts` and `decide.ts` are unchanged from the walking-skeleton commit.

## Verified here (not asserted)
- `node --import tsx --test "src/*.test.ts"` : 8 pass, 0 fail.
- `tsc -p tsconfig.json --noEmit` : clean.

## Runner choice
node:test + tsx, not vitest. Reasons: tsx resolves the NodeNext `.js` specifiers to the `.ts` sources without a resolver hook, it runs on the CI-pinned Node 20, and it adds one dev dependency instead of an esbuild test stack. The repo CI (`pnpm test` then `turbo run test`) will now run this package's real suite.

## Caveat acknowledged
The control share on the fixture ids is about 13.3 percent (266 of 2000), not the nominal 10. The test bounds absorb it; true calibration is W3's job on the real bandit. The assertion message now prints the observed share when it fails, so drift is visible.

## Still carried forward (human sign-off)
- The decision policy is a deterministic stand-in. The real contextual bandit (W3) needs human design and sign-off.
- The premium-unlock path depends on `spend_coins` (0002), still unreviewed ledger code.
