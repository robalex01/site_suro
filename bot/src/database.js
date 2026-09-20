/**
 * database.js — Neon PostgreSQL queries
 */

import os from "node:os";
import { neon } from "@neondatabase/serverless";
import { CONFIG } from "./config.js";

export const sql = neon(CONFIG.DATABASE_URL);

// ─── Single-instance lock ──────────────────────────────────────────────────────
//
// Guards against two bot processes (e.g. an orphaned process from a bad
// restart) both logging into Discord with the same token and both trying to
// handle every button interaction — which is exactly what produces a storm
// of "Unknown interaction" / "already acknowledged" errors (only one of the
// two racing processes can win each ack).
//
// One row, id=1. Whoever holds a fresh (recently-renewed) heartbeat owns the
// lock. The acquire query is a single atomic UPSERT — its WHERE clause only
// lets the update through if the existing lock is stale, so two processes
// starting at the same instant can't both succeed (Postgres row-locks the
// row during the UPDATE, so they're serialized and only the first sees a
// stale row).

async function ensureLockTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS bot_instance_lock (
            id             INTEGER PRIMARY KEY DEFAULT 1,
            instance_id    TEXT NOT NULL,
            hostname       TEXT,
            pid            INTEGER,
            started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT bot_instance_lock_single_row CHECK (id = 1)
        )
    `;
}

/**
 * Attempts to become the single active instance.
 * @returns {Promise<{acquired: true} | {acquired: false, heldBy: object}>}
 */
export async function acquireInstanceLock(instanceId, staleAfterSeconds = 30) {
    await ensureLockTable();

    const rows = await sql`
        INSERT INTO bot_instance_lock (id, instance_id, hostname, pid, started_at, last_heartbeat)
        VALUES (1, ${instanceId}, ${os.hostname()}, ${process.pid}, now(), now())
        ON CONFLICT (id) DO UPDATE
            SET instance_id    = EXCLUDED.instance_id,
                hostname       = EXCLUDED.hostname,
                pid            = EXCLUDED.pid,
                started_at     = now(),
                last_heartbeat = now()
        WHERE bot_instance_lock.last_heartbeat < now() - (${staleAfterSeconds}::text || ' seconds')::interval
        RETURNING instance_id, started_at
    `;

    if (rows.length > 0) return { acquired: true };

    const [current] = await sql`
        SELECT instance_id, hostname, pid, started_at, last_heartbeat FROM bot_instance_lock WHERE id = 1
    `;
    return { acquired: false, heldBy: current };
}

/**
 * Refreshes our heartbeat. Returns false if we no longer hold the lock
 * (someone else's instance_id is now in the row) — the caller must then
 * shut down immediately to stop handling interactions in parallel with
 * whoever took over.
 */
export async function renewInstanceLock(instanceId) {
    const rows = await sql`
        UPDATE bot_instance_lock
        SET last_heartbeat = now()
        WHERE id = 1 AND instance_id = ${instanceId}
        RETURNING instance_id
    `;
    return rows.length > 0;
}

/** Best-effort release on graceful shutdown, so a fast restart doesn't have to wait out the stale timeout. */
export async function releaseInstanceLock(instanceId) {
    try {
        await sql`DELETE FROM bot_instance_lock WHERE id = 1 AND instance_id = ${instanceId}`;
    } catch { /* best-effort */ }
}

// ─── Request → channel message tracking ─────────────────────────────────────
//
// The True/False Code buttons are sent to the claimer's DMs (never posted
// in the channel), so an interaction on them arrives with `interaction.message`
// pointing at the DM, not the original public request embed. To still
// refresh that original channel message (so staff watching the channel see
// the outcome, not just whoever got the DM), we need a durable phone ->
// {channel, message} lookup that survives a bot restart — an in-memory-only
// map would go blank on redeploy while a request is mid-flight.

async function ensureRequestMessagesTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS bot_request_messages (
            phone      TEXT PRIMARY KEY,
            channel_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `;
}

export async function setRequestMessage(phone, channelId, messageId) {
    await ensureRequestMessagesTable();
    await sql`
        INSERT INTO bot_request_messages (phone, channel_id, message_id, updated_at)
        VALUES (${phone}, ${channelId}, ${messageId}, now())
        ON CONFLICT (phone) DO UPDATE
            SET channel_id = EXCLUDED.channel_id,
                message_id = EXCLUDED.message_id,
                updated_at = now()
    `;
}

export async function getRequestMessage(phone) {
    await ensureRequestMessagesTable();
    const rows = await sql`
        SELECT channel_id, message_id FROM bot_request_messages WHERE phone = ${phone} LIMIT 1
    `;
    return rows[0] || null;
}

export async function deleteRequestMessage(phone) {
    try { await sql`DELETE FROM bot_request_messages WHERE phone = ${phone}`; }
    catch { /* best-effort cleanup, non-fatal */ }
}

// ─── Per-staff-member preferences ──────────────────────────────────────────────
//
// Personal settings (language, whether they want to be pinged, etc.) —
// scoped to one Discord user ID each. Never touches CONFIG or affects
// anyone else; this is intentionally separate from bot_instance_lock and
// every other table that describes bot-wide state.

async function ensureStaffPrefsTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS staff_preferences (
            discord_user_id TEXT PRIMARY KEY,
            language        TEXT NOT NULL DEFAULT 'en',
            receive_pings   BOOLEAN NOT NULL DEFAULT true,
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `;
    // Added after the table already existed in production, so CREATE TABLE
    // IF NOT EXISTS above won't retrofit them — explicit migrations instead.
    // dm_alert_operators: comma-separated operator groups ("orange,sfr"); NULL/empty = all groups.
    // snooze_until: DM alerts suppressed until this time; NULL = not snoozed.
    // daily_summary: opt-in to the end-of-day personal activity DM.
    // last_summary_sent_date: guards against sending the daily summary twice in one day.
    await sql`ALTER TABLE staff_preferences ADD COLUMN IF NOT EXISTS dm_alert_operators TEXT`;
    await sql`ALTER TABLE staff_preferences ADD COLUMN IF NOT EXISTS snooze_until TIMESTAMPTZ`;
    await sql`ALTER TABLE staff_preferences ADD COLUMN IF NOT EXISTS daily_summary BOOLEAN NOT NULL DEFAULT false`;
    await sql`ALTER TABLE staff_preferences ADD COLUMN IF NOT EXISTS last_summary_sent_date DATE`;
}

const DEFAULT_STAFF_PREFS = {
    language: "en",
    receive_pings: true,
    dm_alert_operators: null,
    snooze_until: null,
    daily_summary: false,
    last_summary_sent_date: null,
};

/** Returns this user's prefs, or the defaults (not yet persisted) if they've never configured anything. */
export async function getStaffPrefs(discordUserId) {
    await ensureStaffPrefsTable();
    const rows = await sql`
        SELECT language, receive_pings, dm_alert_operators, snooze_until, daily_summary, last_summary_sent_date
        FROM staff_preferences WHERE discord_user_id = ${discordUserId} LIMIT 1
    `;
    return rows[0] || { ...DEFAULT_STAFF_PREFS };
}

/** Partial update — only the keys passed in `patch` are changed, everything else keeps its current (or default) value. */
export async function upsertStaffPrefs(discordUserId, patch) {
    await ensureStaffPrefsTable();
    const current = await getStaffPrefs(discordUserId);
    const next    = { ...current, ...patch };
    await sql`
        INSERT INTO staff_preferences
            (discord_user_id, language, receive_pings, dm_alert_operators, snooze_until, daily_summary, last_summary_sent_date, updated_at)
        VALUES
            (${discordUserId}, ${next.language}, ${next.receive_pings}, ${next.dm_alert_operators}, ${next.snooze_until}, ${next.daily_summary}, ${next.last_summary_sent_date}, now())
        ON CONFLICT (discord_user_id) DO UPDATE
            SET language                = EXCLUDED.language,
                receive_pings           = EXCLUDED.receive_pings,
                dm_alert_operators      = EXCLUDED.dm_alert_operators,
                snooze_until            = EXCLUDED.snooze_until,
                daily_summary           = EXCLUDED.daily_summary,
                last_summary_sent_date  = EXCLUDED.last_summary_sent_date,
                updated_at              = now()
    `;
    return next;
}

/**
 * Discord user IDs of everyone who has explicitly turned pings OFF.
 *
 * Deliberately returns the OPT-OUT list rather than the opt-in one: the
 * default is pings ON, and someone who has never opened the settings
 * panel has no row in this table at all. Asking "who opted out" gives a
 * correct answer for those people (they aren't in the list, so they get
 * pinged); asking "who opted in" would silently drop every staff member
 * who never touched their settings.
 */
export async function getPingOptOutIds() {
    await ensureStaffPrefsTable();
    const rows = await sql`
        SELECT discord_user_id FROM staff_preferences WHERE receive_pings = false
    `;
    return rows.map(r => r.discord_user_id);
}

/**
 * Candidates for the personal "new request" DM alert: everyone with a
 * preferences row who has receive_pings = true. Note this can ONLY ever
 * include staff who have opened the settings panel at least once (any
 * interaction there creates their row) — without a members-list intent,
 * the bot has no way to know who else holds the access role, so someone
 * who has never touched their settings is invisible to this feature and
 * only reachable via the channel's @role ping.
 */
export async function getDmAlertCandidates() {
    await ensureStaffPrefsTable();
    return await sql`
        SELECT discord_user_id, dm_alert_operators, snooze_until, language
        FROM staff_preferences
        WHERE receive_pings = true
    `;
}

/** Staff who opted into the daily summary and haven't received today's yet. */
export async function getDailySummaryCandidates() {
    await ensureStaffPrefsTable();
    return await sql`
        SELECT discord_user_id, language
        FROM staff_preferences
        WHERE daily_summary = true
          AND (last_summary_sent_date IS NULL OR last_summary_sent_date < CURRENT_DATE)
    `;
}

export async function markDailySummarySent(discordUserId) {
    await ensureStaffPrefsTable();
    await sql`UPDATE staff_preferences SET last_summary_sent_date = CURRENT_DATE WHERE discord_user_id = ${discordUserId}`;
}

/** Deletes a staff member's row, returning them to the defaults (English, pings on). */
export async function resetStaffPrefs(discordUserId) {
    await ensureStaffPrefsTable();
    await sql`DELETE FROM staff_preferences WHERE discord_user_id = ${discordUserId}`;
    return { ...DEFAULT_STAFF_PREFS };
}

// ─── Static / singleton bot messages ───────────────────────────────────────────
//
// For persistent panel messages the bot posts once and then edits in place
// on every future restart (e.g. the staff-settings panel) rather than
// spamming a fresh copy every time the process comes back up.

async function ensureStaticMessagesTable() {
    await sql`
        CREATE TABLE IF NOT EXISTS bot_static_messages (
            name       TEXT PRIMARY KEY,
            channel_id TEXT NOT NULL,
            message_id TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `;
}

export async function getStaticMessage(name) {
    await ensureStaticMessagesTable();
    const rows = await sql`
        SELECT channel_id, message_id FROM bot_static_messages WHERE name = ${name} LIMIT 1
    `;
    return rows[0] || null;
}

export async function setStaticMessage(name, channelId, messageId) {
    await ensureStaticMessagesTable();
    await sql`
        INSERT INTO bot_static_messages (name, channel_id, message_id, updated_at)
        VALUES (${name}, ${channelId}, ${messageId}, now())
        ON CONFLICT (name) DO UPDATE
            SET channel_id = EXCLUDED.channel_id,
                message_id = EXCLUDED.message_id,
                updated_at = now()
    `;
}

// ─── Single-row lookups ───────────────────────────────────────────────────────

export async function getRequestByPhone(phone) {
    const rows = await sql`
        SELECT * FROM snap_requests WHERE phone = ${phone} LIMIT 1
    `;
    return rows[0] || null;
}

/**
 * Returns the Discord user ID of whoever claimed this request.
 * Used as fallback when the in-memory claimedBy Map is empty (bot restart).
 * Requires the claimed_by_discord_id column (migration_v2.2.sql).
 */
export async function getClaimedBy(phone) {
    const rows = await sql`
        SELECT claimed_by_discord_id FROM snap_requests WHERE phone = ${phone} LIMIT 1
    `;
    return rows[0]?.claimed_by_discord_id ?? null;
}

export async function updateStatus(phone, status) {
    await sql`UPDATE snap_requests SET status = ${status} WHERE phone = ${phone}`;
}

// ─── Personal lookups (settings-panel buttons) ─────────────────────────────────

/**
 * Requests this staff member currently holds, still in an active (not
 * terminal) state. Requires the claimed_by_discord_id column (same one
 * getClaimedBy relies on).
 */
export async function getActiveClaims(discordUserId) {
    return await sql`
        SELECT phone, operator, status, updated_at
        FROM snap_requests
        WHERE claimed_by_discord_id = ${discordUserId}
          AND status NOT IN ('completed', 'wrong_number')
        ORDER BY updated_at DESC
        LIMIT 15
    `;
}

/**
 * Personal action counts for one staff member, keyed by action name, plus
 * how many of those happened today. Keyed by Discord TAG (not ID) because
 * that's what's actually logged in snap_logs.details — the same field the
 * leaderboard/activity commands already aggregate on, so this stays
 * consistent with those rather than introducing a second identity scheme.
 */
export async function getPersonalStats(staffTag) {
    const byAction = await sql`
        SELECT action, COUNT(*) AS count
        FROM snap_logs
        WHERE details->>'staff_tag' = ${staffTag}
        GROUP BY action
    `;
    const [today] = await sql`
        SELECT COUNT(*) AS count
        FROM snap_logs
        WHERE details->>'staff_tag' = ${staffTag}
          AND created_at >= CURRENT_DATE
    `;
    return { byAction, today: Number(today?.count || 0) };
}

/** This staff member's most recent logged actions, newest first. */
export async function getRecentActions(staffTag, limit = 10) {
    return await sql`
        SELECT action, details, created_at
        FROM snap_logs
        WHERE details->>'staff_tag' = ${staffTag}
        ORDER BY created_at DESC
        LIMIT ${limit}
    `;
}

/**
 * Today's action-count breakdown for one staff member, keyed by action
 * name (claim / true_code / false_code / etc.) — used by the daily-summary
 * DM. Same staff-tag convention as getPersonalStats/getRecentActions above.
 */
export async function getDailySummaryActionCounts(staffTag) {
    return await sql`
        SELECT action, COUNT(*) AS count
        FROM snap_logs
        WHERE details->>'staff_tag' = ${staffTag}
          AND created_at >= CURRENT_DATE
        GROUP BY action
    `;
}

// ─── Logging ──────────────────────────────────────────────────────────────────

export async function logAction(action, details) {
    try {
        await sql`
            INSERT INTO snap_logs (action, details)
            VALUES (${action}, ${JSON.stringify(details)})
        `;
    } catch {
        // snap_logs may not exist in older deployments — non-fatal
    }
}

// ─── Polling queries ──────────────────────────────────────────────────────────

/**
 * Returns pending requests updated after `since`.
 * Timestamp-based (like getCodeSubmittedRequests) so a request that gets
 * reset back to 'pending' on an EXISTING row (e.g. re-submitted after
 * wrong_number, or a safe upsert reset) is detected too — not just brand
 * new INSERTs. An id-based cursor misses these, leaving the request stuck
 * invisible in the DB while the old Discord message goes stale.
 */
export async function getPendingRequests(since) {
    return await sql`
        SELECT id, username, phone, operator, country, city, ip_address, status, created_at, updated_at
        FROM snap_requests
        WHERE status = ${"pending"} AND updated_at > ${since.toISOString()}
        ORDER BY updated_at ASC
    `;
}

/**
 * Returns code_submitted requests updated after `since`.
 * Timestamp-based so retries (same row, new UPDATE) are detected.
 */
export async function getCodeSubmittedRequests(since) {
    return await sql`
        SELECT id, username, phone, operator, country, city, ip_address,
               staff_code, code_length, status, created_at, updated_at
        FROM snap_requests
        WHERE status = ${"code_submitted"}
          AND staff_code IS NOT NULL
          AND updated_at > ${since.toISOString()}
        ORDER BY updated_at ASC
    `;
}

// ─── Stats queries ────────────────────────────────────────────────────────────

export async function getGlobalStats() {
    const [totals] = await sql`
        SELECT
            COUNT(*)                                              AS total,
            COUNT(*) FILTER (WHERE status = 'pending')           AS pending,
            COUNT(*) FILTER (WHERE status = 'processing')        AS processing,
            COUNT(*) FILTER (WHERE status = 'waiting_code')      AS waiting,
            COUNT(*) FILTER (WHERE status = 'code_submitted')    AS submitted,
            COUNT(*) FILTER (WHERE status = 'completed')         AS completed,
            COUNT(*) FILTER (WHERE status = 'wrong_number')      AS wrong,
            COUNT(*) FILTER (WHERE status = 'retry_code')        AS retry
        FROM snap_requests
    `;
    const [banRow] = await sql`SELECT COUNT(*) AS count FROM banned_ips`;
    return { ...totals, banned: banRow.count };
}

export async function getTodayStats() {
    const [today] = await sql`
        SELECT
            COUNT(*)                                         AS requests,
            COUNT(*) FILTER (WHERE status = 'completed')    AS completed
        FROM snap_requests
        WHERE created_at >= CURRENT_DATE
    `;
    return today;
}

export async function getOperatorStats() {
    return await sql`
        SELECT operator, COUNT(*) AS count
        FROM snap_requests
        GROUP BY operator
        ORDER BY count DESC
    `;
}

export async function getHourlyStats() {
    return await sql`
        SELECT EXTRACT(HOUR FROM created_at) AS hour, COUNT(*) AS count
        FROM snap_requests
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY hour
        ORDER BY hour
    `;
}

export async function getStaffLeaderboard(limit = 10) {
    return await sql`
        SELECT
            details->>'staff_tag' AS staff,
            COUNT(*)              AS validations
        FROM snap_logs
        WHERE action = ${"true_code"}
          AND details->>'staff_tag' IS NOT NULL
        GROUP BY details->>'staff_tag'
        ORDER BY validations DESC
        LIMIT ${limit}
    `;
}

export async function getStaffActivity() {
    return await sql`
        SELECT
            details->>'staff_tag' AS staff,
            action,
            COUNT(*)              AS count
        FROM snap_logs
        WHERE details->>'staff_tag' IS NOT NULL
        GROUP BY details->>'staff_tag', action
        ORDER BY count DESC
    `;
}
