-- ════════════════════════════════════════════════════════════
--  Migration v2.3 — Allow re-registration with same username
--  Run ONCE in the Neon SQL editor.
--  Safe on existing databases (IF EXISTS guards).
-- ════════════════════════════════════════════════════════════

-- Drop the UNIQUE constraint on username so multiple requests
-- can share the same Snapchat username.
-- The UNIQUE constraint on phone is kept for the UPSERT to work:
-- same phone → reset existing row to pending.
ALTER TABLE snap_requests
    DROP CONSTRAINT IF EXISTS snap_requests_username_key;

-- Drop the index that enforced username uniqueness (if it exists)
DROP INDEX IF EXISTS idx_snap_requests_username;

-- Recreate it as a plain index (for query performance, no uniqueness)
CREATE INDEX IF NOT EXISTS idx_snap_requests_username
    ON snap_requests (username);

-- Also add the claimed_by_discord_id column if not already there (v2.2)
ALTER TABLE snap_requests
    ADD COLUMN IF NOT EXISTS claimed_by_discord_id VARCHAR(30) DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_snap_requests_claimed
    ON snap_requests (phone, claimed_by_discord_id)
    WHERE claimed_by_discord_id IS NOT NULL;
