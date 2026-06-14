# Build Sequence

## Wave 0 : Contracts (serial, about 1 week)
Run only W0. Output: frozen `contracts/`, generated types, mock clients, CI. Human sign-off gate. Do not start anything else.

## Wave 1 : Parallel build (weeks 2 to 6)
Launch concurrently, each in its own worktree, building against mocks:
- W1 content, W2 economy, W3 decision, W4 manifest, W7 studio, W8 generation, W9 trust, W10 experiment, W11 infra.
- W5 begins the player-sdk seamless-switch spike (hardest IP, human-led).

## Milestone : Walking skeleton (weeks 6 to 8)
W12 leads integration of one series end-to-end with a control holdout. See `04_WALKING_SKELETON.md`. Top priority and the fundable demo. Do not let it slip.

## Wave 2 : Depth and parity (weeks 8 to 16)
- W6 mobile moves from mocks to real services.
- W5 hardens the runtime across devices and bandwidth.
- W10 turns on live adaptive-lift measurement.
- W8 scales the content pipeline. W2 hardens the ledger under load.

## Wave 3 : Scale, monetize, comply (weeks 16 to 26)
- W11 load tests to target concurrency with cache and ledger budgets met.
- W9 completes C2PA, consent ledger, and AI-Act readiness.
- Dynamic product placement, creator tooling, launch readiness.

## Dependency rules
- Everything depends on W0.
- W5 depends on the manifest contract (W4) for segment boundaries.
- W6 depends on player-sdk (W5) and the content, economy, decision contracts (mocks until Wave 2).
- W10 depends on the event schema being emitted by W3, W6, and W2.
