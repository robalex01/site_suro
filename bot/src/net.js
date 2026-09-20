/**
 * net.js — process-wide HTTP tuning. Import this FIRST in bot.js.
 *
 * WHY: Node's built-in fetch (used by the Neon driver, api.js, and — through
 * undici — discord.js's REST client) closes idle keep-alive sockets after
 * only ~4 seconds. This bot's traffic is bursty (a poll every 5s, a click
 * every few seconds), so almost every single call was paying for a brand
 * new TCP + TLS handshake to Neon / Discord / Vercel. On a healthy network
 * that costs ~100-300ms; on this host (see the console: 1-3s deferReply,
 * "Connect Timeout Error ... timeout: 10000ms") it costs seconds and is the
 * most likely step to time out outright.
 *
 * Keeping sockets alive for 30s (max 2 min) means the 5s poll and the
 * interaction traffic reuse warm connections instead of reconnecting.
 * connect/headers/body timeouts are also tightened so a hung socket fails
 * fast (and gets retried by the callers) instead of hanging for 10-15s.
 *
 * Pinned to undici 6.x in package.json on purpose: mixing a newer undici
 * major with Node's built-in fetch breaks with "invalid onRequestStart
 * method". If undici can't be loaded at all, we fall back to Node's
 * defaults rather than crash — this is an optimisation, never a requirement.
 */

let installed = false;

try {
    const { Agent, setGlobalDispatcher } = await import("undici");
    setGlobalDispatcher(new Agent({
        keepAliveTimeout:    30_000,
        keepAliveMaxTimeout: 120_000,
        connect:             { timeout: 6_000 },
        headersTimeout:      15_000,
        bodyTimeout:         15_000,
    }));
    installed = true;
    console.log("🌐 Keep-alive HTTP dispatcher installed (30s idle keep-alive, 6s connect timeout)");
} catch (e) {
    console.warn("⚠️  Could not install the keep-alive HTTP dispatcher — using Node defaults:", e.message);
}

export const keepAliveInstalled = installed;
