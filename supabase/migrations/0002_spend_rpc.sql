-- 0002_spend_rpc.sql : the ACID, idempotent, server-priced coin spend.
-- Owner: W2 (economy). Load-bearing: requires security-review subagent + human sign-off before merge.
-- Implements the spend_coins contract documented in 0001_init.sql. No em dashes.

CREATE OR REPLACE FUNCTION spend_coins(
  p_user UUID,
  p_scope TEXT,            -- 'episode' | 'beat_variant'
  p_scope_id UUID,
  p_client_txn_id TEXT
) RETURNS INTEGER          -- returns the new total balance (balance + bonus_balance)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost      INTEGER;
  v_balance   INTEGER;
  v_bonus     INTEGER;
  v_total     INTEGER;
  v_from_bonus INTEGER;
  v_from_main  INTEGER;
BEGIN
  -- 1. Idempotency: if this client transaction was already applied, return current total, no-op.
  IF EXISTS (
    SELECT 1 FROM coin_transactions
    WHERE user_id = p_user AND client_txn_id = p_client_txn_id
  ) THEN
    SELECT balance, bonus_balance INTO v_balance, v_bonus FROM coin_wallet WHERE user_id = p_user;
    RETURN COALESCE(v_balance,0) + COALESCE(v_bonus,0);
  END IF;

  -- 2. Server-authoritative price. Never trust a client value.
  IF p_scope = 'episode' THEN
    SELECT coin_cost INTO v_cost FROM episodes WHERE id = p_scope_id;
  ELSIF p_scope = 'beat_variant' THEN
    SELECT coin_cost INTO v_cost FROM beat_variants WHERE id = p_scope_id;
  ELSE
    RAISE EXCEPTION 'invalid_scope';
  END IF;
  IF v_cost IS NULL THEN
    RAISE EXCEPTION 'unknown_scope_id';
  END IF;

  -- 3. Lock the wallet row, then check funds. Bonus coins are spent first.
  SELECT balance, bonus_balance INTO v_balance, v_bonus
    FROM coin_wallet WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_wallet';
  END IF;

  v_total := v_balance + v_bonus;
  IF v_total < v_cost THEN
    RAISE EXCEPTION 'insufficient_funds';
  END IF;

  v_from_bonus := LEAST(v_bonus, v_cost);
  v_from_main  := v_cost - v_from_bonus;

  -- 4. Record the immutable transaction (idempotency key enforced by the UNIQUE(user_id, client_txn_id)).
  INSERT INTO coin_transactions (user_id, amount, type, client_txn_id, reference_id)
  VALUES (p_user, -v_cost, 'spend', p_client_txn_id, p_scope_id::text);

  -- 5. Deduct, bonus first.
  UPDATE coin_wallet
     SET bonus_balance = bonus_balance - v_from_bonus,
         balance       = balance - v_from_main,
         updated_at    = NOW()
   WHERE user_id = p_user;

  -- 6. Grant the entitlement (idempotent).
  INSERT INTO entitlements (user_id, scope, scope_id)
  VALUES (p_user, p_scope, p_scope_id)
  ON CONFLICT (user_id, scope, scope_id) DO NOTHING;

  RETURN (v_balance - v_from_main) + (v_bonus - v_from_bonus);
END;
$$;

-- Concurrency test target (W2 DoD): fire thousands of concurrent spend_coins on one wallet with the SAME
-- client_txn_id and assert exactly one deduction and one entitlement; then DISTINCT client_txn_ids and assert
-- no overspend below zero (FOR UPDATE serializes the wallet row).
