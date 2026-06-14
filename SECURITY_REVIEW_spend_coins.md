# Security review : spend_coins (0002_spend_rpc.sql)

> **Status: RESOLVED.** F1-F5 fixed and merged in 731b689 (migration 0003); F1's contract half shipped in economy 0.3.2 (6a7343d). F6 decided: kept as-is (deliberate entitlement-record for free unlocks). This document is the point-in-time review; see those commits for the fixes.

Adversarial read of the coin-spend RPC against the v0.3.0 schema and the RLS floor, with the two
executable specs (the PGlite behavioral suite and the embedded-postgres concurrency suite) read
alongside. This review recommends; it does not edit the frozen RPC. Every fix below is for the W2 owner
to apply under your sign-off. Confidence is tagged per finding. No em dashes.

## Verdict

The arithmetic and the concurrency are sound and proven: bonus-first deduction, the funds guard, the
`FOR UPDATE` serialization, and `UNIQUE`-enforced single-charge all hold, the last two under a real
40 and 50-way race. The risk in this function is not its math. It is the trust boundary. As written,
the function trusts a caller-supplied `p_user` and is executable by `PUBLIC`. Whether that is
catastrophic or harmless depends entirely on how it is exposed, and that exposure is not pinned down
anywhere in the contracts. That ambiguity is the headline.

## Findings, by severity

### F1 [Critical, exposure-dependent] Caller-supplied identity with no binding, plus PUBLIC execute

`spend_coins(p_user UUID, ...)` (lines 5 to 21) acts on whatever `p_user` the caller passes. It is
`SECURITY DEFINER` (line 12), so it runs as the owner and bypasses the RLS floor that 0001 enables on
`coin_wallet`, `coin_transactions`, and `entitlements` (0001 lines 156 to 158). There is no
`auth.uid() = p_user` check, and there is no `REVOKE EXECUTE ... FROM PUBLIC` anywhere in the
migrations (verified: the file contains no GRANT or REVOKE), so the default Postgres grant of EXECUTE
to PUBLIC stands.

[Certain] In combination: if this function is reachable by an authenticated client (for example
exposed as a Supabase/PostgREST RPC, which is the default for a `public` function), any logged-in user
can call `spend_coins('<another-users-uuid>', 'beat_variant', '<id>', '<txn>')` and spend a victim's
coins, writing entitlements at the victim's expense. RLS does not save you here because the definer
context bypasses it.

[Likely] The intended design is that a trusted server role calls this with `p_user` taken from the
authenticated session, never the client directly. That is a valid design, but it is currently an
unwritten assumption, not an enforced control.

Recommended fix (review call):
- `REVOKE EXECUTE ON FUNCTION spend_coins(...) FROM PUBLIC;` and `GRANT` only to the trusted service
  role.
- If the function is ever to be callable in an authenticated session context, add a guard:
  `IF p_user <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;` (or drop `p_user` entirely and
  derive it from `auth.uid()`).
- Document the single intended caller in the contract so this stops being an assumption.

### F2 [High] SECURITY DEFINER search_path permits pg_temp table shadowing

The function sets `SET search_path = public` (line 13) and references its tables unqualified
(`coin_transactions`, `coin_wallet`, `episodes`, `beat_variants`, `entitlements`). [Certain] For
relation lookups, `pg_temp` is searched before the listed schemas unless you pin it. A hostile user who
can execute the function can first create a temporary table named, say, `coin_wallet`, and the
definer-context function will resolve the unqualified name to that temp table, reading attacker-chosen
balances. This is the classic `SECURITY DEFINER` search_path attack, and `SET search_path = public`
does not close it.

Recommended fix: `SET search_path = ''` and schema-qualify every object (`public.coin_wallet`, and so
on), or at minimum pin `pg_temp` last. Builtins like `gen_random_uuid` are unaffected because
`pg_catalog` is searched first, but the table references are exposed.

### F3 [Medium] TOCTOU between the unlocked EXISTS pre-check and the locked INSERT

The idempotency pre-check (lines 24 to 30) is an unlocked `SELECT EXISTS` that runs before the
`FOR UPDATE` (line 46) and the `INSERT` (line 60). [Certain, proven] The concurrency suite reproduced
the safe outcome (one charge under a 40-way same-txn race), but the clean no-op is timing-dependent:
two callers can both pass the pre-check, then the loser hits `UNIQUE(user_id, client_txn_id)` and
raises `unique_violation` (23505) instead of returning the balance. Safety holds (one charge,
guaranteed by the constraint); determinism of the response does not.

Recommended fix: drop the pre-check and rely on the INSERT, catching the unique violation and returning
the current total, so the no-op is deterministic. Until then, the API layer must map 23505-on-spend to
"already applied". This is the finding the concurrency suite was built to surface.

### F4 [Medium] Idempotency keys on client_txn_id only, not on ownership

[Certain] The only idempotency key is `(user_id, client_txn_id)` (0001 line 111). A caller who already
holds an entitlement can be charged again by presenting a new `client_txn_id` for the same `scope_id`.
The function never checks `entitlements` before charging. Whether re-purchase of owned content should
be rejected server-side is a product plus security decision, but as written it is a double-charge
vector under client bugs or malice.

Recommended fix (if the product rule is "own it once"): before charging, `IF EXISTS (SELECT 1 FROM
entitlements WHERE user_id = p_user AND scope = p_scope AND scope_id = p_scope_id) THEN` return the
current balance as a no-op.

### F5 [Medium] No CHECK (coin_cost >= 0) on the catalog, so a negative price mints coins

[Certain] `episodes.coin_cost` and `beat_variants.coin_cost` are `INTEGER NOT NULL DEFAULT 0` with no
non-negativity check (0001 lines 29, 57). A negative `coin_cost` makes `v_cost` negative, so the
deduction (lines 64 to 68) adds coins, and the wallet `CHECK (balance >= 0)` does not catch an
increase. The price is admin-controlled, so this is defense-in-depth rather than a client-facing hole,
but a single bad catalog row becomes free currency.

Recommended fix: `CHECK (coin_cost >= 0)` on both columns, and a guard `IF v_cost < 0 THEN RAISE
EXCEPTION 'invalid_price'; END IF;` in the function.

### F6 [Low] A zero-cost spend still writes a ledger row and an entitlement

[Likely] With `v_cost = 0` (a free scope), the function still inserts a `coin_transactions` row of
amount 0 and grants the entitlement. Probably intended (a recorded free unlock), but worth a conscious
decision rather than a side effect, since it lets a client write unbounded zero-amount ledger rows with
distinct `client_txn_id`s (a minor ledger-bloat or rate-limit consideration).

## What the function gets right (so the review is balanced)

[Certain] No dynamic SQL anywhere; every value flows through typed parameters, so there is no SQL
injection surface. [Certain, proven] `FOR UPDATE` serializes wallet access (no overspend, balance
never negative, 50-way race). [Certain, proven] `UNIQUE(user_id, client_txn_id)` guarantees single
charge under concurrency. Bonus-first split (lines 56 to 57) and the `insufficient_funds` guard (lines
52 to 53) are correct and behaviorally tested. The wallet `CHECK (balance >= 0)` is a sound last-resort
backstop.

## Priority for the W2 owner

1. F1 first, and before any client can reach this function: settle the trust boundary
   (`REVOKE ... FROM PUBLIC` plus an identity guard or a documented single trusted caller). Nothing
   else matters if a client can spend other users' coins.
2. F2 next: harden `search_path` and qualify the tables. Cheap, removes a real definer-escalation
   vector.
3. F3, F4, F5 are correctness and integrity hardening: fold into the same patch, each is a few lines.
4. F6 is a conscious-decision item, not a blocker.

All of the above are changes to frozen ledger code and the schema. They are the W2 owner's to make,
under your sign-off and a version bump, not mine to apply here.

## Verification (independent, against embedded-postgres)

The testable findings were confirmed empirically here, not just by inspection (a real Postgres boot
with migrations + seed applied):

- **F1 CONFIRMED.** `spend_coins` called with another user's uuid deducted that user's wallet
  (10 -> 5). The function has no identity binding; it acts on `p_user` as given. (The PUBLIC-execute /
  RLS-bypass escalation is the deployment-exposure half, assessed analytically.)
- **F4 CONFIRMED.** After a user already owned the premium scope, a second call with a new
  `client_txn_id` charged again (5 -> 0, two spend rows, one entitlement). Re-charge of owned content
  is real.
- **F5 CONFIRMED, with a detail.** With a `beat_variant.coin_cost` set to -5, a spend raised the wallet
  total 10 -> 15 and the RPC returned 15. The minted coins land in `bonus_balance` specifically
  (`v_from_bonus = LEAST(bonus, -5) = -5`, so `bonus_balance -= -5`), which neither wallet
  `CHECK (>= 0)` catches. A negative catalog price mints currency.
- **F3 already proven** by the concurrency suite (40-way same-txn race: safe single charge, but the
  clean no-op is timing-dependent).
- **F2 not exercised here.** The `pg_temp` definer-shadowing attack is documented Postgres behavior;
  `SET search_path = public` does not block `pg_temp` for relation lookups. **F6** is a design
  observation, not a bug.
