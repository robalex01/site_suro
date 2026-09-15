/**
 * claimStore.js — single source of truth for "who claimed this request"
 *
 * OPTIMIZATION: buttons.js and polling.js each used to keep their own
 * in-memory Map + their own copy-pasted DB fallback logic to answer
 * "who claimed this phone number". Two copies of the same cache risked
 * drifting out of sync (e.g. one side sets a claimer the other never sees).
 * This module is the single place that owns that state.
 */

import { getClaimedBy } from "../database.js";

/** phone -> Discord user ID */
export const claimedBy = new Map();

/** Record a claim (in-memory, source of truth for hot lookups). */
export function setClaimer(phone, userId) {
    claimedBy.set(phone, userId);
}

/** Remove a claim (unclaim, wrong number, code validated, etc.). */
export function clearClaimer(phone) {
    claimedBy.delete(phone);
}

/** Sync lookup only — does not hit the DB. Use when you know it's already warm. */
export function peekClaimer(phone) {
    return claimedBy.get(phone) ?? null;
}

/**
 * Resolve the claimer for a phone: in-memory first, DB fallback (covers the
 * case where the bot restarted and the Map was wiped). Result is cached
 * back into memory so subsequent calls for the same phone are free.
 */
export async function getClaimer(phone) {
    let claimer = claimedBy.get(phone) ?? null;
    if (!claimer) {
        claimer = await getClaimedBy(phone);
        if (claimer) claimedBy.set(phone, claimer);
    }
    return claimer;
}
