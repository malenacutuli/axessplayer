-- 0003_harden_spend_coins.sql : security and integrity hardening of the coin spend.
-- PROPOSAL for the W2 owner. Addresses the security review findings:
--   F1 trust boundary  : REVOKE EXECUTE FROM PUBLIC, grant only to a trusted server role.
--   F2 search_path      : SET search_path = '' and schema-qualify every object (no pg_temp shadowing).
--   F3 idempotency race  : check idempotency UNDER the wallet lock, with an INSERT catch as backstop,
--                          so a concurrent duplicate is a deterministic no-op, never a 23505 error.
--   F5 negative price    : CHECK (coin_cost >= 0) on the catalog plus an in-function guard.
--   F4 ownership idempo.  : own-once. If the user already holds the entitlement, the spend no-ops.
--                          Product rule chosen: durable content is bought once, never re-charged.
-- Only F6 (zero-cost spends write ledger rows) is left as a conscious design call. No em dashes.

-- F5: a catalog price can never be negative at the source.
ALTER TABLE episodes      ADD CONSTRAINT episodes_coin_cost_nonneg      CHECK (coin_cost >= 0);
ALTER TABLE beat_variants ADD CONSTRAINT beat_variants_coin_cost_nonneg CHECK (coin_cost >= 0);

CREATE OR REPLACE FUNCTION spend_coins(
  p_user UUID,
  p_scope TEXT,            -- 'episode' | 'beat_variant'
  p_scope_id UUID,
  p_client_txn_id TEXT
) RETURNS INTEGER          -- returns the new total balance (balance + bonus_balance)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''       -- F2: nothing is resolved through a caller-controlled schema or pg_temp
AS $$
DECLARE
  v_cost       INTEGER;
  v_balance    INTEGER;
  v_bonus      INTEGER;
  v_total      INTEGER;
  v_from_bonus INTEGER;
  v_from_main  INTEGER;
BEGIN
  -- 1. Lock the wallet row FIRST so the idempotency check below is serialized (F3).
  SELECT balance, bonus_balance INTO v_balance, v_bonus
    FROM public.coin_wallet WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_wallet';
  END IF;

  -- 2. Idempotency UNDER the lock (F3). A concurrent duplicate that arrives after the first commits
  --    sees the row here and no-ops cleanly; one that slips past loses the INSERT race in step 5 and
  --    is caught there. Either way the result is deterministic, and a replay never raises a spurious
  --    insufficient_funds because we return before the funds check.
  IF EXISTS (
    SELECT 1 FROM public.coin_transactions
    WHERE user_id = p_user AND client_txn_id = p_client_txn_id
  ) THEN
    RETURN COALESCE(v_balance, 0) + COALESCE(v_bonus, 0);
  END IF;

  -- 2b. Ownership idempotency (F4, own-once). Durable content is bought once. If the user already holds
  --     this entitlement, the spend is a no-op: a new client_txn_id must never re-charge owned content.
  --     Checked under the wallet lock so concurrent distinct-txn buys of the same scope settle to one
  --     charge. (This function only ever grants durable entitlements, never consumables.)
  IF EXISTS (
    SELECT 1 FROM public.entitlements
    WHERE user_id = p_user AND scope = p_scope AND scope_id = p_scope_id
  ) THEN
    RETURN COALESCE(v_balance, 0) + COALESCE(v_bonus, 0);
  END IF;

  -- 3. Server-authoritative price. Never trust a client value.
  IF p_scope = 'episode' THEN
    SELECT coin_cost INTO v_cost FROM public.episodes WHERE id = p_scope_id;
  ELSIF p_scope = 'beat_variant' THEN
    SELECT coin_cost INTO v_cost FROM public.beat_variants WHERE id = p_scope_id;
  ELSE
    RAISE EXCEPTION 'invalid_scope';
  END IF;
  IF v_cost IS NULL THEN
    RAISE EXCEPTION 'unknown_scope_id';
  END IF;
  IF v_cost < 0 THEN
    RAISE EXCEPTION 'invalid_price';   -- F5: defense in depth behind the CHECK constraint
  END IF;

  -- 4. Funds check. Bonus coins are spent first.
  v_total := v_balance + v_bonus;
  IF v_total < v_cost THEN
    RAISE EXCEPTION 'insufficient_funds';
  END IF;
  v_from_bonus := LEAST(v_bonus, v_cost);
  v_from_main  := v_cost - v_from_bonus;

  -- 5. Record the immutable transaction. The UNIQUE(user_id, client_txn_id) is the real idempotency
  --    guarantee; catching its violation makes a lost concurrent race a no-op rather than an error (F3).
  BEGIN
    INSERT INTO public.coin_transactions (user_id, amount, type, client_txn_id, reference_id)
    VALUES (p_user, -v_cost, 'spend', p_client_txn_id, p_scope_id::text);
  EXCEPTION WHEN unique_violation THEN
    RETURN COALESCE(v_balance, 0) + COALESCE(v_bonus, 0);
  END;

  -- 6. Deduct, bonus first.
  UPDATE public.coin_wallet
     SET bonus_balance = bonus_balance - v_from_bonus,
         balance       = balance - v_from_main,
         updated_at    = NOW()
   WHERE user_id = p_user;

  -- 7. Grant the entitlement (idempotent).
  INSERT INTO public.entitlements (user_id, scope, scope_id)
  VALUES (p_user, p_scope, p_scope_id)
  ON CONFLICT (user_id, scope, scope_id) DO NOTHING;

  RETURN (v_balance - v_from_main) + (v_bonus - v_from_bonus);
END;
$$;

-- F1: the client must never reach this directly. Only a trusted server role may execute it, and that
-- caller is responsible for setting p_user from the authenticated session. If you later choose to expose
-- it in an authenticated session context, add inside the function:
--     IF p_user <> auth.uid() THEN RAISE EXCEPTION 'forbidden'; END IF;
REVOKE EXECUTE ON FUNCTION public.spend_coins(UUID, TEXT, UUID, TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.spend_coins(UUID, TEXT, UUID, TEXT) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.spend_coins(UUID, TEXT, UUID, TEXT) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.spend_coins(UUID, TEXT, UUID, TEXT) TO service_role';
  END IF;
END $$;
