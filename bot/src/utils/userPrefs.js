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

const TTL_MS = 60_000;

/** userId -> { prefs, expiresAt } */
const cache = new Map();

export const DEFAULT_PREFS = { language: "en", receive_pings: true };

/**
 * Preferences for one staff member. Never throws and never returns
 * undefined — on any DB failure it returns the defaults (English, pings
 * on), which is exactly the behaviour someone who has never opened the
 * settings panel gets anyway.
 */
export async function getPrefs(userId) {
    const hit = cache.get(userId);
    if (hit && hit.expiresAt > Date.now()) return hit.prefs;

    try {
        const prefs = await getStaffPrefs(userId);
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
