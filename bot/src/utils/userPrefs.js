/**
 * userPrefs.js — cached per-staff preference lookups
 *
 * Why a cache at all: every button interaction now needs to know the
 * clicker's language before it can word its reply. Hitting Postgres on
 * every single click would add a DB round-trip to the hot path of an
 * interaction that already has a hard 3-second ack budget (see the
 * safeDefer notes in buttons.js — DB latency eating that window is
 * exactly what used to cause "Unknown interaction" errors). A short
 * in-memory TTL keeps the common case at zero network calls while still
 * picking up a change made from another process within a minute.
 *
 * Nothing here is authoritative — Postgres is. The cache only ever holds
 * a copy, is written through immediately on every change made by this
 * process, and falls back to the defaults if the DB is unreachable, so a
 * database blip degrades a staff member to English + pings on rather
 * than breaking their interaction entirely.
 */

import { getStaffPrefs } from "../database.js";

// A long TTL is safe here rather than risky: this process is the only one
// that can change these values (the instance lock in bot.js guarantees a
// single running bot), and every change it makes is written through the
// cache immediately via primePrefs. So the cache can't drift out of sync
// with Postgres — the TTL exists only to eventually pick up a row edited
// directly in the database by hand.
const TTL_MS = 15 * 60_000;

// Hard ceiling on how long a preference lookup may take. Preferences decide
// what LANGUAGE a reply is worded in — they are never worth delaying or
// failing the reply itself over. If the database is slow or down, fall back
// to English immediately rather than sitting on the interaction.
const LOOKUP_TIMEOUT_MS = 800;

/** userId -> { prefs, expiresAt } */
const cache = new Map();

export const DEFAULT_PREFS = {
    language: "en",
    receive_pings: true,
    dm_alert_operators: null,
    snooze_until: null,
    daily_summary: false,
    last_summary_sent_date: null,
};

function withTimeout(promise, ms) {
    return Promise.race([
        promise,
        new Promise((_, reject) => setTimeout(() => reject(new Error(`preference lookup exceeded ${ms}ms`)), ms)),
    ]);
}

/**
 * Synchronous, zero-latency language lookup: reads the cache and nothing
 * else, returning English on a miss.
 *
 * Use this ANYWHERE the interaction has not been acknowledged yet (no
 * deferReply/deferUpdate has run). Discord gives a hard 3-second window to
 * acknowledge, and an interaction that expires is gone — the user sees
 * "This interaction failed" and the action never happens. Wording a reply
 * in someone's preferred language is not worth spending any part of that
 * budget on, so before the ack we never touch the network.
 *
 * After the ack, use getLang/getPrefs instead: the reply is already
 * guaranteed and a DB round-trip is free at that point.
 */
export function peekLang(userId) {
    const hit = cache.get(userId);
    if (hit && hit.expiresAt > Date.now()) return hit.prefs.language || DEFAULT_PREFS.language;
    // Warm the cache for next time, without waiting for it or letting a
    // rejection escape into an unhandled promise.
    getPrefs(userId).catch(() => {});
    return DEFAULT_PREFS.language;
}

/**
 * Preferences for one staff member. Never throws and never returns
 * undefined — on any DB failure or timeout it returns the defaults
 * (English, pings on), which is exactly the behaviour someone who has
 * never opened the settings panel gets anyway.
 */
export async function getPrefs(userId) {
    const hit = cache.get(userId);
    if (hit && hit.expiresAt > Date.now()) return hit.prefs;

    try {
        const prefs = await withTimeout(getStaffPrefs(userId), LOOKUP_TIMEOUT_MS);
        cache.set(userId, { prefs, expiresAt: Date.now() + TTL_MS });
        return prefs;
    } catch (e) {
        console.warn(`⚠️  Could not load prefs for ${userId}, falling back to defaults:`, e.message);
        return { ...DEFAULT_PREFS };
    }
}

/** Just the language code — the overwhelmingly common use. */
export async function getLang(userId) {
    return (await getPrefs(userId)).language || DEFAULT_PREFS.language;
}

/**
 * Write-through update after this process changes someone's prefs, so
 * the very next interaction sees the new value instead of waiting out
 * the TTL (a staff member switching to French then immediately clicking
 * a button would otherwise still get English for up to a minute).
 */
export function primePrefs(userId, prefs) {
    cache.set(userId, { prefs, expiresAt: Date.now() + TTL_MS });
}

export function invalidatePrefs(userId) {
    cache.delete(userId);
}
