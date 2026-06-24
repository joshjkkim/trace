-- Migration: convert PROJECTS.id and all dependent FKs from int8 to uuid
-- Run in Supabase SQL Editor in one go.

BEGIN;

-- ============================================================
-- STEP 1: Add new uuid column to PROJECTS alongside old int8 id
-- ============================================================
ALTER TABLE "PROJECTS" ADD COLUMN new_id uuid DEFAULT gen_random_uuid();
UPDATE "PROJECTS" SET new_id = gen_random_uuid() WHERE new_id IS NULL;

-- ============================================================
-- STEP 2: Add new uuid project_id columns to dependent tables
-- ============================================================
ALTER TABLE "CALLS"     ADD COLUMN new_project_id uuid;
ALTER TABLE "ANOMALIES" ADD COLUMN new_project_id uuid;
ALTER TABLE "USAGE"     ADD COLUMN new_project_id uuid;

-- ============================================================
-- STEP 3: Populate new FK columns using the old int→uuid mapping
-- ============================================================
UPDATE "CALLS"
    SET new_project_id = p.new_id
    FROM "PROJECTS" p
    WHERE "CALLS".project_id = p.id;

UPDATE "ANOMALIES"
    SET new_project_id = p.new_id
    FROM "PROJECTS" p
    WHERE "ANOMALIES".project_id = p.id;

UPDATE "USAGE"
    SET new_project_id = p.new_id
    FROM "PROJECTS" p
    WHERE "USAGE".project_id = p.id;

-- ============================================================
-- STEP 4: Drop old FK constraints on dependent tables
-- ============================================================
ALTER TABLE "ANOMALIES" DROP CONSTRAINT IF EXISTS "ANOMALIES_project_id_fkey";
ALTER TABLE "CALLS"     DROP CONSTRAINT IF EXISTS "CALLS_project_id_fkey";
ALTER TABLE "USAGE"     DROP CONSTRAINT IF EXISTS "USAGE_project_id_fkey";

-- ============================================================
-- STEP 5: Swap PROJECTS primary key from int8 to uuid
-- ============================================================
ALTER TABLE "PROJECTS" DROP CONSTRAINT "PROJECTS_pkey";
ALTER TABLE "PROJECTS" DROP COLUMN id;
ALTER TABLE "PROJECTS" RENAME COLUMN new_id TO id;
ALTER TABLE "PROJECTS" ADD PRIMARY KEY (id);

-- ============================================================
-- STEP 6: Swap project_id columns in dependent tables
-- ============================================================
ALTER TABLE "CALLS"     DROP COLUMN project_id;
ALTER TABLE "CALLS"     RENAME COLUMN new_project_id TO project_id;

ALTER TABLE "ANOMALIES" DROP COLUMN project_id;
ALTER TABLE "ANOMALIES" RENAME COLUMN new_project_id TO project_id;

ALTER TABLE "USAGE"     DROP COLUMN project_id;
ALTER TABLE "USAGE"     RENAME COLUMN new_project_id TO project_id;

-- ============================================================
-- STEP 7: Re-add FK constraints pointing to new uuid PK
-- ============================================================
ALTER TABLE "CALLS"
    ADD CONSTRAINT "CALLS_project_id_fkey"
    FOREIGN KEY (project_id) REFERENCES "PROJECTS"(id) ON DELETE CASCADE;

ALTER TABLE "ANOMALIES"
    ADD CONSTRAINT "ANOMALIES_project_id_fkey"
    FOREIGN KEY (project_id) REFERENCES "PROJECTS"(id) ON DELETE CASCADE;

ALTER TABLE "USAGE"
    ADD CONSTRAINT "USAGE_project_id_fkey"
    FOREIGN KEY (project_id) REFERENCES "PROJECTS"(id) ON DELETE CASCADE;

-- ============================================================
-- STEP 8: Fix PROJECTS.owner (int8 → uuid, references PROFILES.id)
-- NOTE: old owner values were int8 from the old PROFILES table and
-- cannot be auto-mapped to new UUID PROFILES ids. They are set to
-- NULL here — reassign them manually or via the UI after running.
-- ============================================================
ALTER TABLE "PROJECTS" ADD COLUMN new_owner uuid;
ALTER TABLE "PROJECTS" DROP COLUMN owner;
ALTER TABLE "PROJECTS" RENAME COLUMN new_owner TO owner;
ALTER TABLE "PROJECTS"
    ADD CONSTRAINT "PROJECTS_owner_fkey"
    FOREIGN KEY (owner) REFERENCES "PROFILES"(id) ON DELETE CASCADE;

-- ============================================================
-- STEP 9: Fix PROFILES.project_list (bigint[] → uuid[])
-- ============================================================
ALTER TABLE "PROFILES" DROP COLUMN IF EXISTS project_list;
ALTER TABLE "PROFILES" ADD COLUMN project_list uuid[] DEFAULT '{}';

COMMIT;
