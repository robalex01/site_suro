/**
 * database.js — MySQL / MariaDB queries (mysql2)
 *
 * Migrated from Neon/PostgreSQL. The exported function names and return
 * shapes are unchanged, so nothing else in the bot needed to change.
 *
 * Connection: either DATABASE_URL=mysql://user:password@host:3306/dbname
 * (special characters in the password must be URL-encoded), or the separate
 * DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME variables (no encoding
 * needed). If DB_HOST is set it wins over DATABASE_URL.
 *
 * Dates: the pool uses timezone "Z", so JS Dates are written and read as the
 * same naive value — a cursor written by the bot and read back by the bot
 * always round-trips exactly. Polling cursors are seeded from the DATABASE's
 * own clock (getDbNow) so they stay consistent with updated_at values written
 * by the PHP site, whatever timezone the DB server runs in.
 */

import os from "node:os";
import mysql from "mysql2/promise";
import { CONFIG } from "./config.js";

// ─── Pool ─────────────────────────────────────────────────────────────────────

function safeDecode(s) {
    try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * Tolerant mysql:// URL parser. The user info is everything before the LAST '@',
 * split at the first ':' — so the password may itself contain @ # / ? : and so on
 * (the WHATWG `new URL()` rejects or truncates those).
 */
function parseDbUrl(raw) {
    const s = String(raw || "")
        .trim()
        .replace(/^DATABASE_URL\s*=\s*/i, "")   // value pasted together with its key
        .replace(/^(["'])(.*)\1$/, "$2");       // surrounding quotes

    if (/^postgres(ql)?:/i.test(s)) {
        throw new Error(
            "DATABASE_URL still points to Postgres (postgres://…) — the bot now uses MySQL/MariaDB. " +
            "Replace it with mysql://user:password@host:3306/dbname (or set DB_HOST / DB_USER / DB_PASSWORD / DB_NAME instead)."
        );
    }
    const m = s.match(/^(?:mysql|mariadb):\/\/(.*)@([^@/?#]+)(\/[^?#]*)?(\?.*)?$/i);
    if (!m) {
        throw new Error(`DATABASE_URL is not valid (expected mysql://user:password@host:3306/dbname) — it starts with "${s.slice(0, 8)}" and is ${s.length} characters long`);
    }

    const [, userinfo, hostport, path = "", query = ""] = m;
    const colon = userinfo.indexOf(":");
    const hp    = hostport.match(/^(.*?)(?::(\d+))?$/);

    return {
        host:     hp[1],
        port:     hp[2] ? Number(hp[2]) : 3306,
        user:     safeDecode(colon < 0 ? userinfo : userinfo.slice(0, colon)),
        password: colon < 0 ? "" : safeDecode(userinfo.slice(colon + 1)),
        database: safeDecode(path.replace(/^\//, "")),
        ssl:      /[?&]ssl=(true|1)\b/i.test(query),
    };
}

function buildPoolOptions() {
    let base;

    if (CONFIG.DB.HOST) {
        base = {
            host:     CONFIG.DB.HOST,
            port:     CONFIG.DB.PORT,
            user:     CONFIG.DB.USER,
            password: CONFIG.DB.PASSWORD,
            database: CONFIG.DB.NAME,
        };
    } else {
        const { ssl, ...parsed } = parseDbUrl(CONFIG.DATABASE_URL);
        base = parsed;
        if (ssl) base.ssl = { rejectUnauthorized: false };
    }

    return {
        ...base,
        charset:            "utf8mb4",
        waitForConnections: true,
        connectionLimit:    5,
        queueLimit:         0,
        connectTimeout:     8_000,
        enableKeepAlive:    true,
        keepAliveInitialDelay: 10_000,
        timezone:           "Z",
        // DATE columns come back as "YYYY-MM-DD" strings (not Dates at 00:00Z),
        // so they can be written straight back without drifting.
        dateStrings:        ["DATE"],
    };
}

const pool = mysql.createPool(buildPoolOptions());

// Every connection runs in UTC, exactly like the website's API (api/_db.js), so
// NOW() / CURRENT_TIMESTAMP defaults written by either side agree with the JS
// Dates read back here. Queued before any caller's query on that connection.
pool.pool.on("connection", (conn) => {
    conn.query("SET time_zone = '+00:00'", () => {});
});

// ─── Resilient query wrapper ───────────────────────────────────────────────────
//
// Every query gets a per-attempt timeout and up to 2 quick retries with a short
// jittered backoff, but ONLY for transport-level errors (connection reset/lost,
// timeout, DNS blip) — a genuine SQL error (bad syntax, constraint violation)
// is thrown immediately, never retried. Every statement this bot runs is
// idempotent (upserts, UPDATEs by key, CREATE TABLE IF NOT EXISTS), so a retry
// after a lost response is safe.

const DB_ATTEMPT_TIMEOUT_MS = 8_000;
const DB_MAX_RETRIES        = 2;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function isTransientDbError(e) {
    const text = [e?.message, e?.code, e?.cause?.message, e?.cause?.code].filter(Boolean).join(" ");
    return /PROTOCOL_CONNECTION_LOST|PROTOCOL_SEQUENCE_TIMEOUT|ER_CON_COUNT_ERROR|Connection lost|closed state|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|socket|network|timed? ?out|Connect Timeout/i.test(text);
}

function runWithTimeout(makeQuery, ms) {
    let timer;
    return Promise.race([
        Promise.resolve().then(makeQuery),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`db query timed out after ${ms}ms`)), ms); }),
    ]).finally(() => clearTimeout(timer));
}

async function withRetry(makeQuery) {
    let lastErr;
    for (let attempt = 0; attempt <= DB_MAX_RETRIES; attempt++) {
        try {
            return await runWithTimeout(makeQuery, DB_ATTEMPT_TIMEOUT_MS);
        } catch (e) {
            lastErr = e;
            if (!isTransientDbError(e) || attempt === DB_MAX_RETRIES) break;
            await sleep(250 * (attempt + 1) + Math.random() * 150);
        }
    }
    throw lastErr;
}

function run(text, params) {
    return withRetry(async () => {
        const [result] = await pool.query(text, params);
        return result; // SELECT → array of rows; INSERT/UPDATE/DELETE → { affectedRows, ... }
    });
}

/** Tagged template: sql`SELECT * FROM t WHERE a = ${x}` — values become ? placeholders. */
export function sql(strings, ...values) {
    return run(strings.join("?"), values);
}

/** Plain form: query("SELECT ... WHERE a = ?", [x]). */
export function query(text, params = []) {
    return run(text, params);
}

/** The database server's own current time (same clock/timezone as updated_at defaults). */
export async function getDbNow() {
    const [row] = await sql`SELECT NOW(3) AS now`;
    return new Date(row.now);
}

/**
 * Seed for the polling cursors, taken from the DATA itself.
 *
 * WHY NOT NOW(): snap_requests.updated_at is written by the website (its own
 * session time zone), whereas NOW() here is evaluated in THIS bot's session.
 * If the two sessions are not in the same time zone (seen in prod: the bot's
 * rows were stamped 2 h ahead of the site's), a cursor built from NOW() sits
 * in the future relative to every request and the poller never finds any of
 * them — no error, no log, no embed. MAX(updated_at) is by construction in
 * the same clock domain as the rows we compare it with.
 *
 * dbNow / dbUtc / tz are returned only so the startup log can say whether the
 * bot's session is really on UTC.
 */
export async function getPollingSeed() {
    const [row] = await sql`
        SELECT MAX(updated_at)      AS latest,
               NOW(3)           AS db_now,
               UTC_TIMESTAMP(3) AS db_utc,
               @@session.time_zone AS tz
        FROM snap_requests
    `;
    return {
        latest: row.latest ? new Date(row.latest) : null,
        dbNow:  new Date(row.db_now),
        dbUtc:  new Date(row.db_utc),
        tz:     row.tz,
    };
}

/** One-shot snapshot for the startup log: session timezone, DB clock, and the pending queue. */
export async function getPollingDiagnostics() {
    const [info]    = await sql`SELECT @@session.time_zone AS tz, NOW(3) AS now`;
    const [pending] = await sql`SELECT COUNT(*) AS n, MAX(updated_at) AS latest FROM snap_requests WHERE status = 'pending'`;
    return { tz: info.tz, now: new Date(info.now), pending: Number(pending.n), latest: pending.latest ? new Date(pending.latest) : null };
}

/**
 * Runs an async initialiser exactly once per process and shares the result.
 * A failure is NOT cached — the next caller retries.
 */
function once(fn) {
    let promise = null;
    return () => {
        if (!promise) {
            promise = Promise.resolve().then(fn).catch(e => { promise = null; throw e; });
        }
        return promise;
    };
}

function toDbDate(value) {
    if (value === null || value === undefined || value === "") return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

function parseJson(value) {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch { return null; }
}

const TABLE_OPTS = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";

// ─── Single-instance lock ──────────────────────────────────────────────────────
//
// Guards against two bot processes (e.g. an orphaned process from a bad
// restart) both logging into Discord with the same token and both trying to
// handle every button interaction — which is exactly what produces a storm
// of "Unknown interaction" / "already acknowledged" errors.
//
// One row, id=1. Whoever holds a fresh (recently-renewed) heartbeat owns the
// lock. Acquisition runs in a transaction holding a row lock (SELECT ... FOR
// UPDATE), so two processes starting at the same instant are serialized and
// only the first sees a stale row. Staleness is measured with the database's
// own clock (TIMESTAMPDIFF ... NOW()), never the bot host's.

async function createLockTable() {
    await query(`
        CREATE TABLE IF NOT EXISTS bot_instance_lock (
            id             INT NOT NULL PRIMARY KEY DEFAULT 1,
            instance_id    VARCHAR(64) NOT NULL,
            hostname       VARCHAR(255) NULL,
            pid            INT NULL,
            started_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            last_heartbeat DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ${TABLE_OPTS}
    `);
}
const ensureLockTable = once(createLockTable);

/**
 * Attempts to become the single active instance.
 * @returns {Promise<{acquired: true} | {acquired: false, heldBy: object}>}
 */
export async function acquireInstanceLock(instanceId, staleAfterSeconds = 30) {
    await ensureLockTable();

    return withRetry(async () => {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            // Make sure the row exists (no-op if it does), then lock it.
            await conn.query(
                `INSERT IGNORE INTO bot_instance_lock (id, instance_id, hostname, pid, started_at, last_heartbeat)
                 VALUES (1, ?, ?, ?, NOW(), NOW())`,
                [instanceId, os.hostname(), process.pid]
            );
            const [rows] = await conn.query(
                `SELECT instance_id, hostname, pid, started_at, last_heartbeat,
                        TIMESTAMPDIFF(SECOND, last_heartbeat, NOW()) AS age_seconds
                 FROM bot_instance_lock WHERE id = 1 FOR UPDATE`
            );
            const current = rows[0];

            // Ours already (fresh insert just above, or a retried acquire whose
            // first attempt succeeded but lost its response) or the holder's
            // heartbeat has gone stale → take it.
            if (current.instance_id === instanceId || Number(current.age_seconds) > staleAfterSeconds) {
                await conn.query(
                    `UPDATE bot_instance_lock
                     SET instance_id = ?, hostname = ?, pid = ?, started_at = NOW(), last_heartbeat = NOW()
                     WHERE id = 1`,
                    [instanceId, os.hostname(), process.pid]
                );
                await conn.commit();
                return { acquired: true };
            }

            await conn.rollback();
            return { acquired: false, heldBy: current };
        } catch (e) {
            await conn.rollback().catch(() => {});
            throw e;
        } finally {
            conn.release();
        }
    });
}

/**
 * Refreshes our heartbeat. Returns false if we no longer hold the lock
 * (someone else's instance_id is now in the row) — the caller must then
 * shut down immediately to stop handling interactions in parallel with
 * whoever took over.
 */
export async function renewInstanceLock(instanceId) {
    await sql`UPDATE bot_instance_lock SET last_heartbeat = NOW() WHERE id = 1 AND instance_id = ${instanceId}`;
    // Checked with a SELECT rather than affectedRows: MySQL reports 0 affected
    // rows when the new value equals the old one (same second).
    const rows = await sql`SELECT instance_id FROM bot_instance_lock WHERE id = 1`;
    return rows[0]?.instance_id === instanceId;
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
// refresh that original channel message, we need a durable phone ->
// {channel, message} lookup that survives a bot restart.

async function createRequestMessagesTable() {
    await query(`
        CREATE TABLE IF NOT EXISTS bot_request_messages (
            phone      VARCHAR(32) NOT NULL PRIMARY KEY,
            channel_id VARCHAR(32) NOT NULL,
            message_id VARCHAR(32) NOT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ${TABLE_OPTS}
    `);
}
const ensureRequestMessagesTable = once(createRequestMessagesTable);

export async function setRequestMessage(phone, channelId, messageId) {
    await ensureRequestMessagesTable();
    await sql`
        INSERT INTO bot_request_messages (phone, channel_id, message_id, updated_at)
        VALUES (${phone}, ${channelId}, ${messageId}, NOW())
        ON DUPLICATE KEY UPDATE
            channel_id = VALUES(channel_id),
            message_id = VALUES(message_id),
            updated_at = NOW()
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
// scoped to one Discord user ID each.
//
// Columns:
//   dm_alert_operators: comma-separated operator groups ("orange,sfr"); NULL/empty = all groups.
//   snooze_until: DM alerts suppressed until this time; NULL = not snoozed.
//   daily_summary: opt-in to the end-of-day personal activity DM.
//   last_summary_sent_date: guards against sending the daily summary twice in one day.

async function createStaffPrefsTable() {
    await query(`
        CREATE TABLE IF NOT EXISTS staff_preferences (
            discord_user_id        VARCHAR(32) NOT NULL PRIMARY KEY,
            language               VARCHAR(8) NOT NULL DEFAULT 'en',
            receive_pings          TINYINT(1) NOT NULL DEFAULT 1,
            dm_alert_operators     VARCHAR(255) NULL,
            snooze_until           DATETIME NULL,
            daily_summary          TINYINT(1) NOT NULL DEFAULT 0,
            last_summary_sent_date DATE NULL,
            updated_at             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ${TABLE_OPTS}
    `);
}
const ensureStaffPrefsTable = once(createStaffPrefsTable);

const DEFAULT_STAFF_PREFS = {
    language: "en",
    receive_pings: true,
    dm_alert_operators: null,
    snooze_until: null,
    daily_summary: false,
    last_summary_sent_date: null,
};

/** TINYINT(1) comes back as 0/1 — turn it into real booleans like Postgres gave us. */
function normPrefs(row) {
    if (!row) return row;
    return { ...row, receive_pings: !!row.receive_pings, daily_summary: !!row.daily_summary };
}

/** This user's persisted row, or null if they've never configured anything. */
export async function findStaffPrefsRow(discordUserId) {
    await ensureStaffPrefsTable();
    const rows = await sql`
        SELECT language, receive_pings, dm_alert_operators, snooze_until, daily_summary, last_summary_sent_date
        FROM staff_preferences WHERE discord_user_id = ${discordUserId} LIMIT 1
    `;
    return rows[0] ? normPrefs(rows[0]) : null;
}

/** Every persisted row — used to preload the in-memory preferences cache (userPrefs.js) in one query. */
export async function getAllStaffPrefs() {
    await ensureStaffPrefsTable();
    const rows = await sql`
        SELECT discord_user_id, language, receive_pings, dm_alert_operators, snooze_until, daily_summary, last_summary_sent_date
        FROM staff_preferences
    `;
    return rows.map(normPrefs);
}

/** Returns this user's prefs, or the defaults (not yet persisted) if they've never configured anything. */
export async function getStaffPrefs(discordUserId) {
    return (await findStaffPrefsRow(discordUserId)) || { ...DEFAULT_STAFF_PREFS };
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
            (${discordUserId}, ${next.language}, ${next.receive_pings ? 1 : 0}, ${next.dm_alert_operators}, ${toDbDate(next.snooze_until)}, ${next.daily_summary ? 1 : 0}, ${next.last_summary_sent_date}, NOW())
        ON DUPLICATE KEY UPDATE
            language               = VALUES(language),
            receive_pings          = VALUES(receive_pings),
            dm_alert_operators     = VALUES(dm_alert_operators),
            snooze_until           = VALUES(snooze_until),
            daily_summary          = VALUES(daily_summary),
            last_summary_sent_date = VALUES(last_summary_sent_date),
            updated_at             = NOW()
    `;
    return next;
}

/**
 * Discord user IDs of everyone who has explicitly turned pings OFF.
 * Returns the OPT-OUT list rather than the opt-in one: the default is pings
 * ON, and someone who never opened the settings panel has no row at all.
 */
export async function getPingOptOutIds() {
    await ensureStaffPrefsTable();
    const rows = await sql`
        SELECT discord_user_id FROM staff_preferences WHERE receive_pings = 0
    `;
    return rows.map(r => r.discord_user_id);
}

/**
 * Candidates for the personal "new request" DM alert: everyone with a
 * preferences row who has receive_pings on.
 */
export async function getDmAlertCandidates() {
    await ensureStaffPrefsTable();
    const rows = await sql`
        SELECT discord_user_id, dm_alert_operators, snooze_until, language
        FROM staff_preferences
        WHERE receive_pings = 1
    `;
    return rows.map(normPrefs);
}

/** Staff who opted into the daily summary and haven't received today's yet. */
export async function getDailySummaryCandidates() {
    await ensureStaffPrefsTable();
    return await sql`
        SELECT discord_user_id, language
        FROM staff_preferences
        WHERE daily_summary = 1
          AND (last_summary_sent_date IS NULL OR last_summary_sent_date < CURDATE())
    `;
}

export async function markDailySummarySent(discordUserId) {
    await ensureStaffPrefsTable();
    await sql`UPDATE staff_preferences SET last_summary_sent_date = CURDATE() WHERE discord_user_id = ${discordUserId}`;
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
// on every future restart (e.g. the staff-settings panel).

async function createStaticMessagesTable() {
    await query(`
        CREATE TABLE IF NOT EXISTS bot_static_messages (
            name       VARCHAR(100) NOT NULL PRIMARY KEY,
            channel_id VARCHAR(32) NOT NULL,
            message_id VARCHAR(32) NOT NULL,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ${TABLE_OPTS}
    `);
}
const ensureStaticMessagesTable = once(createStaticMessagesTable);

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
        VALUES (${name}, ${channelId}, ${messageId}, NOW())
        ON DUPLICATE KEY UPDATE
            channel_id = VALUES(channel_id),
            message_id = VALUES(message_id),
            updated_at = NOW()
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
 * Requires the claimed_by_discord_id column on snap_requests.
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
 * terminal) state.
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

// snap_logs.details is JSON, keyed by Discord TAG (not ID). JSON_UNQUOTE +
// JSON_EXTRACT works on both MySQL and MariaDB (the ->> operator is MySQL-only).
const STAFF_TAG = "JSON_UNQUOTE(JSON_EXTRACT(details, '$.staff_tag'))";

/**
 * Personal action counts for one staff member, keyed by action name, plus
 * how many of those happened today.
 */
export async function getPersonalStats(staffTag) {
    const byAction = await query(
        `SELECT action, COUNT(*) AS \`count\`
         FROM snap_logs
         WHERE ${STAFF_TAG} = ?
         GROUP BY action`,
        [staffTag]
    );
    const [today] = await query(
        `SELECT COUNT(*) AS \`count\`
         FROM snap_logs
         WHERE ${STAFF_TAG} = ?
           AND created_at >= UTC_DATE()`,
        [staffTag]
    );
    return { byAction, today: Number(today?.count || 0) };
}

/** This staff member's most recent logged actions, newest first. */
export async function getRecentActions(staffTag, limit = 10) {
    const rows = await query(
        `SELECT action, details, created_at
         FROM snap_logs
         WHERE ${STAFF_TAG} = ?
         ORDER BY created_at DESC
         LIMIT ?`,
        [staffTag, Number(limit) || 10]
    );
    // MariaDB returns JSON columns as strings — hand callers an object either way.
    return rows.map(r => ({ ...r, details: parseJson(r.details) }));
}

/** Today's action-count breakdown for one staff member — used by the daily-summary DM. */
export async function getDailySummaryActionCounts(staffTag) {
    return await query(
        `SELECT action, COUNT(*) AS \`count\`
         FROM snap_logs
         WHERE ${STAFF_TAG} = ?
           AND created_at >= UTC_DATE()
         GROUP BY action`,
        [staffTag]
    );
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
 * Returns pending requests updated after `since` (a Date).
 * Timestamp-based so a request reset back to 'pending' on an EXISTING row
 * is detected too — not just brand new INSERTs. This relies on updated_at
 * being refreshed on every UPDATE (ON UPDATE CURRENT_TIMESTAMP, or set by PHP).
 */
export async function getPendingRequests(since) {
    return await sql`
        SELECT id, username, phone, operator, country, city, ip_address, status, created_at, updated_at
        FROM snap_requests
        WHERE status = 'pending' AND updated_at > ${since}
        ORDER BY updated_at ASC
    `;
}

/**
 * Pending requests that have NO Discord message tracked in bot_request_messages —
 * i.e. requests the bot never managed to post (bot was down / cursor bug /
 * channel error). Used once at startup as a catch-up so nothing stays invisible.
 * (Terminal states call forgetMessage(), so only genuinely un-posted or
 * re-submitted requests match.)
 */
export async function getUnsentPendingRequests() {
    await ensureRequestMessagesTable();
    return await sql`
        SELECT r.id, r.username, r.phone, r.operator, r.country, r.city, r.ip_address,
               r.status, r.created_at, r.updated_at
        FROM snap_requests r
        LEFT JOIN bot_request_messages m ON m.phone = r.phone
        WHERE r.status = 'pending' AND m.phone IS NULL
        ORDER BY r.updated_at ASC
    `;
}

/**
 * Returns code_submitted requests updated after `since` (a Date).
 * Timestamp-based so retries (same row, new UPDATE) are detected.
 */
export async function getCodeSubmittedRequests(since) {
    return await sql`
        SELECT id, username, phone, operator, country, city, ip_address,
               staff_code, code_length, status, created_at, updated_at
        FROM snap_requests
        WHERE status = 'code_submitted'
          AND staff_code IS NOT NULL
          AND updated_at > ${since}
        ORDER BY updated_at ASC
    `;
}

// ─── Stats queries ────────────────────────────────────────────────────────────

export async function getGlobalStats() {
    const [totals] = await sql`
        SELECT
            COUNT(*)                                             AS total,
            COUNT(CASE WHEN status = 'pending'        THEN 1 END) AS pending,
            COUNT(CASE WHEN status = 'processing'     THEN 1 END) AS processing,
            COUNT(CASE WHEN status = 'waiting_code'   THEN 1 END) AS waiting,
            COUNT(CASE WHEN status = 'code_submitted' THEN 1 END) AS submitted,
            COUNT(CASE WHEN status = 'completed'      THEN 1 END) AS completed,
            COUNT(CASE WHEN status = 'wrong_number'   THEN 1 END) AS wrong,
            COUNT(CASE WHEN status = 'retry_code'     THEN 1 END) AS retry
        FROM snap_requests
    `;
    const [banRow] = await sql`SELECT COUNT(*) AS \`count\` FROM banned_ips`;
    return { ...totals, banned: banRow.count };
}

export async function getTodayStats() {
    const [today] = await sql`
        SELECT
            COUNT(*)                                          AS requests,
            COUNT(CASE WHEN status = 'completed' THEN 1 END)  AS completed
        FROM snap_requests
        WHERE created_at >= UTC_DATE()
    `;
    return today;
}

export async function getOperatorStats() {
    return await sql`
        SELECT operator, COUNT(*) AS \`count\`
        FROM snap_requests
        GROUP BY operator
        ORDER BY \`count\` DESC
    `;
}

export async function getHourlyStats() {
    return await sql`
        SELECT EXTRACT(HOUR FROM created_at) AS \`hour\`, COUNT(*) AS \`count\`
        FROM snap_requests
        WHERE created_at >= UTC_TIMESTAMP() - INTERVAL 24 HOUR
        GROUP BY EXTRACT(HOUR FROM created_at)
        ORDER BY \`hour\`
    `;
}

export async function getStaffLeaderboard(limit = 10) {
    return await query(
        `SELECT
             ${STAFF_TAG} AS staff,
             COUNT(*)     AS validations
         FROM snap_logs
         WHERE action = 'true_code'
           AND ${STAFF_TAG} IS NOT NULL
         GROUP BY ${STAFF_TAG}
         ORDER BY validations DESC
         LIMIT ?`,
        [Number(limit) || 10]
    );
}

export async function getStaffActivity() {
    return await query(
        `SELECT
             ${STAFF_TAG} AS staff,
             action,
             COUNT(*)     AS \`count\`
         FROM snap_logs
         WHERE ${STAFF_TAG} IS NOT NULL
         GROUP BY ${STAFF_TAG}, action
         ORDER BY \`count\` DESC`
    );
}
