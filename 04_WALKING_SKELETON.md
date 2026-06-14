# Walking Skeleton : the first integration milestone

The walking skeleton is one thin path through every layer. When it passes, the thesis is proven and integration is de-risked. Target: weeks 6 to 8. Owned by the QA agent (W12) with slices from W1 to W6.

## Scope (deliberately tiny)
- One series with three beats. Beat 2 is a branch point with two variants (for example calm and tense).
- One cold-open calibration that seeds the viewer vector.
- One premium variant that costs coins to unlock.
- A control group that always receives the fixed director's cut.

## Acceptance test (must pass in CI on a real or emulated device)
1. A new user opens the series. The cold open seeds `viewer_state`.
2. At beat 2, the player calls /decide. The decision service returns a variant and a top-k prefetch list within budget, and writes a `decision_log` row.
3. The manifest service stitches the chosen variant into the playlist. The player switches at the branch with no visible seam or buffer.
4. The user unlocks the premium variant. The economy service performs an idempotent spend. Running the unlock twice with the same client transaction id deducts coins once.
5. Every step emits the events in `contracts/events/events.md`.
6. A user assigned to control receives the fixed director's cut, and `decision_log.is_control` is true.
7. The experiment service reads the logs and reports completion for treatment vs control.

## Definition of done
The acceptance test runs green in CI, end to end, including the idempotency and control-group checks. Demo it on a device. This is the artifact you show investors for adaptive lift.
