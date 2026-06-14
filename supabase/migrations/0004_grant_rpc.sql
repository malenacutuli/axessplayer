-- 0004_grant_rpc.sql : the credit side of the ledger. PROPOSAL for the W2 owner.
-- grant_coins adds coins from a verified receipt or callback (IAP, rewarded ad, offer wall, checkin,
-- refund). Built with the same guarantees the spend_coins security review established:
--   F1 : EXECUTE granted to service_role only. /grant is server-to-server (economy.yaml 0.3.2 serviceAuth).
--   F2 : SET search_path = '' and every object schema-qualified.
--   F3 : idempotency checked UNDER the wallet lock, with a unique_violation catch as backstop.
--   amount guard: a grant amount must be positive (the mirror of F5's non-negative price).
-- Bucket routing is a PRODUCT policy (see below), not a security property. No em dashes.

CREATE OR REPLACE FUNCTION grant_coins(
  p_user UUID,
  p_amount INTEGER,
  p_type TEXT,             -- 'iap' | 'rewarded_ad' | 'offer_wall' | 'checkin' | 'refund'
  p_client_txn_id TEXT
) RETURNS INTEGER          -- returns the new total balance (balance + bonus_balance)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_balance INTEGER;
  v_bonus   INTEGER;
  v_to_bonus BOOLEAN;
BEGIN
  -- 1. Validate inputs. Type is closed; amount must be positive.
  IF p_type NOT IN ('iap', 'rewarded_ad', 'offer_wall', 'checkin', 'refund') THEN
    RAISE EXCEPTION 'invalid_grant_type';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount';
  END IF;

  -- 2. Lock the wallet so the idempotency check is serialized (mirrors spend_coins F3).
  SELECT balance, bonus_balance INTO v_balance, v_bonus
    FROM public.coin_wallet WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no_wallet';
  END IF;

  -- 3. Idempotency under the lock. A retried webhook with the same client_txn_id is a no-op.
  IF EXISTS (
    SELECT 1 FROM public.coin_transactions
    WHERE user_id = p_user AND client_txn_id = p_client_txn_id
  ) THEN
    RETURN v_balance + v_bonus;
  END IF;

  -- 4. Record the immutable credit. The UNIQUE(user_id, client_txn_id) is the real idempotency
  --    guarantee; catching it makes a lost concurrent race a no-op rather than an error.
  BEGIN
    INSERT INTO public.coin_transactions (user_id, amount, type, client_txn_id)
    VALUES (p_user, p_amount, p_type, p_client_txn_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN v_balance + v_bonus;
  END;

  -- 5. Bucket routing (PRODUCT policy, easily changed): purchased and refunded coins are real balance;
  --    earned/promotional coins are bonus, which spend_coins spends first.
  v_to_bonus := p_type IN ('rewarded_ad', 'offer_wall', 'checkin');
  IF v_to_bonus THEN
    UPDATE public.coin_wallet
       SET bonus_balance = bonus_balance + p_amount, updated_at = NOW()
     WHERE user_id = p_user;
  ELSE
    UPDATE public.coin_wallet
       SET balance = balance + p_amount, updated_at = NOW()
     WHERE user_id = p_user;
  END IF;

  RETURN (v_balance + v_bonus) + p_amount;
END;
$$;

-- F1: server-to-server only. Grants run from verified receipts/callbacks, never a client.
REVOKE EXECUTE ON FUNCTION public.grant_coins(UUID, INTEGER, TEXT, TEXT) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.grant_coins(UUID, INTEGER, TEXT, TEXT) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.grant_coins(UUID, INTEGER, TEXT, TEXT) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.grant_coins(UUID, INTEGER, TEXT, TEXT) TO service_role';
  END IF;
END $$;
