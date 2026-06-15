-- 0005_decision_log_propensity.sql : make decision_log training-ready before W3 starts logging.
-- PROPOSAL for the orchestrator. Additive and backward-compatible: one nullable column.
-- Rationale: honest off-policy evaluation (inverse-propensity-scoring, doubly-robust) needs the
-- probability under which the logging policy chose the served arm. decision_log already carries the arm
-- (served_variant_id), the reward, policy_version, and is_control; propensity completes the IPS tuple.
-- Adding it now means the very first decisions W3 logs are usable for training, not backfilled. No em dashes.

ALTER TABLE decision_log
  ADD COLUMN propensity DOUBLE PRECISION;  -- P(served_variant_id | context) under the logging policy at decision time

COMMENT ON COLUMN decision_log.propensity IS
  'Probability the logging policy assigned to the served arm at decision time. Required for off-policy evaluation. Null for control-arm and deterministic-policy decisions.';
