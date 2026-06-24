-- Sprint 1: semantic step identity
-- Run in Supabase SQL Editor

-- pgvector extension (may already be enabled)
CREATE EXTENSION IF NOT EXISTS vector;

-- Step profiles table: one row per unique "type" of step seen in a project
CREATE TABLE IF NOT EXISTS step_profiles (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id    uuid REFERENCES "PROJECTS"(id) ON DELETE CASCADE,
    fingerprint   vector(384),   -- all-MiniLM-L6-v2 output
    step_name     text,          -- latest name seen for this step (cosmetic)
    created_at    timestamptz    NOT NULL DEFAULT now(),
    last_seen_at  timestamptz    NOT NULL DEFAULT now()
);

-- ivfflat index for fast cosine similarity search
CREATE INDEX IF NOT EXISTS idx_step_profiles_fingerprint
    ON step_profiles USING ivfflat (fingerprint vector_cosine_ops)
    WITH (lists = 10);

CREATE INDEX IF NOT EXISTS idx_step_profiles_project
    ON step_profiles (project_id);

-- Link each call to its step profile
ALTER TABLE "CALLS"
    ADD COLUMN IF NOT EXISTS step_profile_id uuid REFERENCES step_profiles(id);

CREATE INDEX IF NOT EXISTS idx_calls_step_profile
    ON "CALLS" (step_profile_id);

-- Similarity search function used by the fingerprinter
CREATE OR REPLACE FUNCTION match_step_profile(
    p_project_id uuid,
    p_embedding  vector(384),
    p_threshold  float DEFAULT 0.75
)
RETURNS TABLE (id uuid, step_name text, similarity float)
LANGUAGE sql STABLE AS $$
    SELECT
        id,
        step_name,
        1 - (fingerprint <=> p_embedding) AS similarity
    FROM step_profiles
    WHERE project_id = p_project_id
      AND 1 - (fingerprint <=> p_embedding) >= p_threshold
    ORDER BY fingerprint <=> p_embedding
    LIMIT 1;
$$;
