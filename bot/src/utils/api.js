/**
 * api.js — Centralized fetch wrapper for the Snaptech API
 * Provides timeout, retry-with-backoff and consistent error handling/logging.
 *
 * v3.3 — Fixed a bug that mislabeled expected 409 "already claimed" conflicts
 * (and any other 4xx business response) as generic network errors:
 *   OLD: any non-2xx status → throw Error("API 409: {json text}")
 *        → callers caught it in their generic catch block and showed a
 *          hardcoded "Network error while claiming" message, throwing away
 *          the real server message ("Cette demande est déjà claim...").
 *   NEW: the server ALWAYS replies with a JSON {success, message} body, even
 *        for 4xx conflicts — that's a normal, expected answer, not a failure.
 *        We only throw for genuine transport failures: no response at all
 *        (handled by fetchWithRetry throwing already), an unparseable body,
 *        or a 5xx that survived every retry. Everything else — including
 *        401 Unauthorized and 409 Conflict — is returned as-is so callers'
 *        existing `if (!data.success)` branches see the real message.
 *
 * v3.2: Under load, the Vercel API can be slow to respond (cold starts,
 * DB latency) and a single timeout used to surface immediately as a hard
 * failure to staff ("Network error while claiming"). Transient failures
 * (timeout, network error, 5xx) now get a couple of quick retries before
 * giving up — 4xx errors (e.g. the 409 double-claim guard) are NOT retried
 * since they're a correct, final answer from the server.
 */

import { CONFIG } from "../config.js";

const FETCH_TIMEOUT_MS = 10000;
const MAX_RETRIES       = 2;
const RETRY_DELAY_MS    = 400;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Like fetchWithTimeout, but retries on transient failures (timeout/network
 * error, or HTTP 5xx). Never retries 4xx — those are final answers (bad
 * request, unauthorized, 409 conflict, etc.) and retrying would just waste
 * time or double-submit an action.
 */
async function fetchWithRetry(url, options = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            const res = await fetchWithTimeout(url, options);
            if (res.status >= 500 && attempt < MAX_RETRIES) {
                lastErr = new Error(`API ${res.status}`);
                await sleep(RETRY_DELAY_MS * (attempt + 1));
                continue;
            }
            return res;
        } catch (e) {
            lastErr = e;
            if (attempt < MAX_RETRIES) {
                await sleep(RETRY_DELAY_MS * (attempt + 1));
                continue;
            }
        }
    }
    throw lastErr;
}

/**
 * Parses a fetch Response as our standard {success, message, ...} JSON body.
 * - 5xx that exhausted retries → throw (genuine server failure, no useful
 *   business message to show, callers should fall back to their generic
 *   "network error" handling).
 * - Anything else (2xx OR 4xx) → return the parsed JSON. A 4xx here is a
 *   normal, final answer from the server (bad secret, already claimed,
 *   not found, etc.), not a transport failure — the caller's `data.success`
 *   check is what's meant to handle it, using the real `data.message`.
 * - Unparseable body on an otherwise-ok-ish response → throw, since we have
 *   nothing usable to return.
 */
async function parseApiResponse(res) {
    let data;
    try {
        data = await res.json();
    } catch {
        throw new Error(`API ${res.status}: (invalid/empty JSON response)`);
    }

    if (!res.ok && res.status >= 500) {
        throw new Error(`API ${res.status}: ${data?.message || "Server error"}`);
    }

    return data; // includes 4xx conflicts like 401/404/409 — these are NOT thrown
}

/**
 * Call /api/staff-action
 * @param {string}      action        - "claim" | "unclaim" | "set_length" | "wrong_number" | "true_code" | "false_code"
 * @param {string}      phone
 * @param {string}      staffTag      - Discord tag shown in logs
 * @param {number|null} length        - Required for set_length (4 or 6)
 * @param {string|null} discordUserId - Discord user ID, stored in DB for persistent claimer tracking
 */
export async function callStaffAction(action, phone, staffTag, length = null, discordUserId = null) {
    const body = {
        action,
        phone,
        secret: CONFIG.STAFF_SECRET,
        staff_tag: staffTag,
    };
    if (length       !== null) body.length          = length;
    if (discordUserId !== null) body.discord_user_id = discordUserId;

    const res = await fetchWithRetry(CONFIG.API_BASE + "/api/staff-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    return parseApiResponse(res);
}

/**
 * Call /api/ban-ip
 * @param {string} ip
 * @param {string} bannedBy - Discord tag
 */
export async function callBanIP(ip, bannedBy) {
    const res = await fetchWithRetry(CONFIG.API_BASE + "/api/ban-ip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, secret: CONFIG.STAFF_SECRET, banned_by: bannedBy }),
    });

    return parseApiResponse(res);
}
