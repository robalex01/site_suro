-- ════════════════════════════════════════════════════════════
--  Migration v2.2 — Claimer persistence
--  Run this ONCE in the Neon SQL editor.
--  Safe to run on an existing database (uses IF NOT EXISTS).
-- ════════════════════════════════════════════════════════════

-- Stores the Discord user ID of the staff member who claimed
-- the request. Used by the bot to enforce button permissions
-- even after a restart (fallback when in-memory Map is empty).
ALTER TABLE snap_requests
    ADD COLUMN IF NOT EXISTS claimed_by_discord_id VARCHAR(30) DEFAULT NULL;

-- Index for quick lookup by phone (permission checks)
CREATE INDEX IF NOT EXISTS idx_snap_requests_claimed
    ON snap_requests (phone, claimed_by_discord_id)
    WHERE claimed_by_discord_id IS NOT NULL;
