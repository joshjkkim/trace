-- Track whether a CALL itself triggered an anomaly so it can be excluded from
-- future baselines. NULL on old rows = treated as false (non-anomalous).
ALTER TABLE "CALLS" ADD COLUMN IF NOT EXISTS anomaly_triggered boolean DEFAULT false;

-- Track the last time a step profile's prompt drifted enough to be flagged as
-- "evolved" (similarity 0.75–0.92). Baseline is scoped to calls after this
-- timestamp so a prompt rewrite doesn't mix old and new behaviour.
ALTER TABLE step_profiles ADD COLUMN IF NOT EXISTS last_evolved_at timestamptz;
