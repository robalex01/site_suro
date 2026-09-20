/**
 * userPrefs.js — in-memory staff preferences (full snapshot + write-through)
 *
 * WHY THIS WAS REWRITTEN
 * The old version cached each user lazily with an 800ms DB timeout and, on a
 * timeout, fell back to English WITHOUT caching anything — so during a slow
 * database period every single click re-ran the same failing lookup (the
 * console showed ~40 "preference lookup exceeded 800ms" lines for the same
 * handful of user IDs), and each lookup itself cost 6+ queries because the
 * table-creation DDL ran on every call.
 *
 * NOW
 *  - The whole staff_preferences table is small (one row per staff member
 *    who ever opened the settings panel), so it is loaded ONCE at startup
 *    and refreshed every 2 minutes in the background.
 *  - After that, getPrefs()/peekLang() are pure in-memory reads: zero
 *    network calls on the interaction path, so the database being slow or
 *    down can no longer affect which language a reply is written in.
 *  - A refresh that fails keeps the previous copy (stale-while-error).
 *  - Someone with NO row is, by definition, on the defaults — once a
 *    snapshot has loaded, a miss answers instantly with defaults instead of
 *    asking the database a question whose answer is already known.
 *  - Every change made by this process is written through immediately via
 *    primePrefs/forgetPrefs, so the very next interaction sees it.
 *  - Only if the very first snapshot has NOT loaded yet (database down at
 *    boot) do we fall back to a per-user lookup, de-duplicated and capped
 *    at LOOKUP_TIMEOUT_MS.
 *
 * Nothing here is authoritative — Postgres is. This only ever holds a copy.
 */

import { findStaffPrefsRow, getAllStaffPrefs } from "../database.js";

const LOOKUP_TIMEOUT_MS   = 2500;
const REFRESH_INTERVAL_MS = 2 * 60_000;
const RETRY_INTERVAL_MS   = 10_000;

export const DEFAULT_PREFS = {
    language: "en",
    receive_pings: true,
    dm_alert_operators: null,
    snooze_until: null,
    daily_summary: false,
    last_summary_sent_date: null,
};

/** userId -> prefs. ONLY people who actually have a row in Postgres. */
const rows = new Map();
/** userId -> ms timestamp of the last local write (protects against an in-flight snapshot overwriting it). */
const writtenAt = new Map();
/** userIds whose cached copy was explicitly invalidated and must be re-read. */
const stale = new Set();
/** userId -> in-flight per-user lookup promise (de-duplicates concurrent lookups). */
const inflight = new Map();

let snapshotLoaded = false;
let failedLoads    = 0;

function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`preference lookup exceeded ${ms}ms`)), ms); }),
    ]).finally(() => clearTimeout(timer));
}

// ─── Snapshot loading ─────────────────────────────────────────────────────────

async function loadSnapshot() {
    const startedAt = Date.now();
    const all       = await getAllStaffPrefs();
    const seen      = new Set();

    for (const r of all) {
        const { discord_user_id: id, ...prefs } = r;
        seen.add(id);
        // Changed locally while this query was in flight → ours is newer than the snapshot.
        if ((writtenAt.get(id) || 0) > startedAt) continue;
        rows.set(id, prefs);
    }
    for (const id of [...rows.keys()]) {
        if (!seen.has(id) && (writtenAt.get(id) || 0) <= startedAt) rows.delete(id);
    }

    stale.clear();
    if (!snapshotLoaded) console.log(`👥 Staff preferences loaded into memory (${rows.size} user${rows.size === 1 ? "" : "s"})`);
    snapshotLoaded = true;
}

/**
 * Loads the snapshot now, then keeps it fresh in the background. Safe to
 * call once at startup and not await: it never rejects and never overlaps
 * itself (each run schedules the next only after it finishes).
 */
export function startPrefsRefresh() {
    const run = async () => {
        let delay = REFRESH_INTERVAL_MS;
        try {
            await loadSnapshot();
            failedLoads = 0;
        } catch (e) {
            failedLoads++;
            delay = RETRY_INTERVAL_MS;
            if (failedLoads === 1 || failedLoads % 6 === 0) {
                console.warn(`⚠️  Could not refresh staff preferences (attempt ${failedLoads}) — keeping the in-memory copy: ${e.message}`);
            }
        }
        setTimeout(run, delay);
    };
    return run();
}

export function isSnapshotLoaded() {
    return snapshotLoaded;
}

/** Everyone who has a persisted row, in the same shape getDmAlertCandidates() returns (plus the other pref fields). */
export function listPersistedPrefs() {
    return [...rows].map(([discord_user_id, prefs]) => ({ discord_user_id, ...prefs }));
}

// ─── Lookups ──────────────────────────────────────────────────────────────────

async function lookupOne(userId) {
    let p = inflight.get(userId);
    if (!p) {
        p = withTimeout(findStaffPrefsRow(userId), LOOKUP_TIMEOUT_MS)
            .then(row => {
                if (row) rows.set(userId, row);
                stale.delete(userId);
                return row || { ...DEFAULT_PREFS };
            })
            .finally(() => inflight.delete(userId));
        inflight.set(userId, p);
    }
    try {
        return await p;
    } catch (e) {
        console.warn(`⚠️  Could not load prefs for ${userId}, falling back to defaults: ${e.message}`);
        return { ...DEFAULT_PREFS };
    }
}

/**
 * Synchronous, zero-latency language lookup: memory only, English on a miss.
 * Use this ANYWHERE the interaction has not been acknowledged yet — Discord
 * gives 3 seconds to ack and wording a reply is never worth spending any of
 * that budget on.
 */
export function peekLang(userId) {
    const hit = rows.get(userId);
    if (hit) return hit.language || DEFAULT_PREFS.language;
    // Only warm the cache if we genuinely don't know yet.
    if (!snapshotLoaded || stale.has(userId)) getPrefs(userId).catch(() => {});
    return DEFAULT_PREFS.language;
}

/**
 * Preferences for one staff member. Never throws and never returns
 * undefined. With a snapshot loaded this is a pure memory read.
 */
export async function getPrefs(userId) {
    const hit = rows.get(userId);
    if (hit) return hit;
    if (snapshotLoaded && !stale.has(userId)) return { ...DEFAULT_PREFS };
    return lookupOne(userId);
}

/** Just the language code — the overwhelmingly common use. */
export async function getLang(userId) {
    return (await getPrefs(userId)).language || DEFAULT_PREFS.language;
}

// ─── Write-through ────────────────────────────────────────────────────────────

/** Call after this process saves someone's prefs, so the next interaction sees them immediately. */
export function primePrefs(userId, prefs) {
    rows.set(userId, prefs);
    writtenAt.set(userId, Date.now());
    stale.delete(userId);
}

/** Call after deleting someone's row (reset to defaults). */
export function forgetPrefs(userId) {
    rows.delete(userId);
    writtenAt.set(userId, Date.now());
    stale.delete(userId);
}

/** Force the next lookup for this user to go back to the database. */
export function invalidatePrefs(userId) {
    rows.delete(userId);
    stale.add(userId);
}
