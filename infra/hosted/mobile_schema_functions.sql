-- Axessplayer ledger functions for the hosted `mobile` schema (project faeyekynudyzeotbjfsj).
-- Retarget of frozen migrations 0003_harden_spend_coins.sql and 0004_grant_rpc.sql: every public.* becomes
-- mobile.*, and the F2 security lock (SET search_path = '' plus full schema-qualification) is preserved exactly.
-- Apply AFTER mobile_schema_deploy.sql. No em dashes.

ALTER TABLE mobile.episodes      ADD CONSTRAINT episodes_coin_cost_nonneg      CHECK (coin_cost >= 0);
ALTER TABLE mobile.beat_variants ADD CONSTRAINT beat_variants_coin_cost_nonneg CHECK (coin_cost >= 0);

CREATE OR REPLACE FUNCTION mobile.spend_coins(
  p_user UUID,
  p_scope TEXT,
  p_scope_id UUID,
  p_client_txn_id TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_cost       INTEGER;
  v_balance    INTEGER;
  v_bonus      INTEGER;
  v_total      INTEGER;
  v_from_bonus INTEGER;
  v_from_main  INTEGER;
BEGIN
  SELECT balance, bonus_balance INTO v_balance, v_bonus
    FROM mobile.coin_wallet WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_wallet';
  END IF;

  IF EXISTS (
    SELECT 1 FROM mobile.coin_transactions
    WHERE user_id = p_user AND client_txn_id = p_client_txn_id
  ) THEN
    RETURN COALESCE(v_balance, 0) + COALESCE(v_bonus, 0);
  END IF;

  IF EXISTS (
    SELECT 1 FROM mobile.entitlements
    WHERE user_id = p_user AND scope = p_scope AND scope_id = p_scope_id
  ) THEN
    RETURN COALESCE(v_balance, 0) + COALESCE(v_bonus, 0);
  END IF;

  IF p_scope = 'episode' THEN
    SELECT coin_cost INTO v_cost FROM mobile.episodes WHERE id = p_scope_id;
  ELSIF p_scope = 'beat_variant' THEN
    SELECT coin_cost INTO v_cost FROM mobile.beat_variants WHERE id = p_scope_id;
  ELSE
    RAISE EXCEPTION 'invalid_scope';
  END IF;
  IF v_cost IS NULL THEN
    RAISE EXCEPTION 'unknown_scope_id';
  END IF;
  IF v_cost < 0 THEN
    RAISE EXCEPTION 'invalid_price';
  END IF;

  v_total := v_balance + v_bonus;
  IF v_total < v_cost THEN
    RAISE EXCEPTION 'insufficient_funds';
  END IF;
  v_from_bonus := LEAST(v_bonus, v_cost);
  v_from_main  := v_cost - v_from_bonus;

  BEGIN
    INSERT INTO mobile.coin_transactions (user_id, amount, type, client_txn_id, reference_id)
    VALUES (p_user, -v_cost, 'spend', p_client_txn_id, p_scope_id::text);
  EXCEPTION WHEN unique_violation THEN
    RETURN COALESCE(v_balance, 0) + COALESCE(v_bonus, 0);
  END;

  UPDATE mobile.coin_wallet
     SET bonus_balance = bonus_balance - v_from_bonus,
         balance       = balance - v_from_main,
         updated_at    = NOW()
   WHERE user_id = p_user;

  INSERT INTO mobile.entitlements (user_id, scope, scope_id)
  VALUES (p_user, p_scope, p_scope_id)
  ON CONFLICT (user_id, scope, scope_id) DO NOTHING;

  RETURN (v_balance - v_from_main) + (v_bonus - v_from_bonus);
END;
$$;

REVOKE EXECUTE ON FUNCTION mobile.spend_coins(UUID, TEXT, UUID, TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION mobile.spend_coins(UUID, TEXT, UUID, TEXT) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION mobile.spend_coins(UUID, TEXT, UUID, TEXT) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION mobile.spend_coins(UUID, TEXT, UUID, TEXT) TO service_role';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION mobile.grant_coins(
  p_user UUID,
  p_amount INTEGER,
  p_type TEXT,
  p_client_txn_id TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_balance INTEGER;
  v_bonus   INTEGER;
  v_to_bonus BOOLEAN;
BEGIN
  IF p_type NOT IN ('iap', 'rewarded_ad', 'offer_wall', 'checkin', 'refund') THEN
    RAISE EXCEPTION 'invalid_grant_type';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  SELECT balance, bonus_balance INTO v_balance, v_bonus
    FROM mobile.coin_wallet WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_wallet';
  END IF;

  IF EXISTS (
    SELECT 1 FROM mobile.coin_transactions
    WHERE user_id = p_user AND client_txn_id = p_client_txn_id
  ) THEN
    RETURN v_balance + v_bonus;
  END IF;

  BEGIN
    INSERT INTO mobile.coin_transactions (user_id, amount, type, client_txn_id)
    VALUES (p_user, p_amount, p_type, p_client_txn_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN v_balance + v_bonus;
  END;

  v_to_bonus := p_type IN ('rewarded_ad', 'offer_wall', 'checkin');
  IF v_to_bonus THEN
    UPDATE mobile.coin_wallet
       SET bonus_balance = bonus_balance + p_amount, updated_at = NOW()
     WHERE user_id = p_user;
  ELSE
    UPDATE mobile.coin_wallet
       SET balance = balance + p_amount, updated_at = NOW()
     WHERE user_id = p_user;
  END IF;

  RETURN (v_balance + v_bonus) + p_amount;
END;
$$;

REVOKE EXECUTE ON FUNCTION mobile.grant_coins(UUID, INTEGER, TEXT, TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION mobile.grant_coins(UUID, INTEGER, TEXT, TEXT) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION mobile.grant_coins(UUID, INTEGER, TEXT, TEXT) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION mobile.grant_coins(UUID, INTEGER, TEXT, TEXT) TO service_role';
  END IF;
END $$;
