-- Add span tracking columns to CALLS for automatic call graph propagation
ALTER TABLE "CALLS" ADD COLUMN IF NOT EXISTS span_id       text;
ALTER TABLE "CALLS" ADD COLUMN IF NOT EXISTS parent_span_id text;

CREATE INDEX IF NOT EXISTS idx_calls_span_id        ON "CALLS" (span_id);
CREATE INDEX IF NOT EXISTS idx_calls_parent_span_id ON "CALLS" (parent_span_id);
