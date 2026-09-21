/**
 * polling.js — DB polling for new Discord notifications
 *
 * v4.1 — MySQL migration fix: "webhook message arrives, bot embeds never do".
 *
 *  - CURSORS ARE NO LONGER BUILT FROM THE CLOCK. They used to start at
 *    NOW() - 30s, where NOW() is evaluated in the BOT's DB session. But
 *    snap_requests.updated_at is written by the website, in ITS session. When
 *    the two sessions are not in the same time zone (prod: bot rows stamped
 *    2 h ahead of the site's rows) the cursor sat 2 h in the future and
 *    `updated_at > cursor` matched nothing, forever — no error, no log, no
 *    embed, bot_request_messages stayed empty. The cursors are now seeded
 *    from MAX(updated_at) of the table itself, which is always in the same
 *    clock domain as the rows being compared.
 *
 *  - RESTART = CLEAN SLATE. Because the cursor starts at "everything already
 *    there", requests that were already pending when the bot (re)started are
 *    NOT posted again — only requests created or updated after startup are.
 *    (A previous version had a startup catch-up that re-posted them; removed
 *    on purpose so a restart never floods the channels with old requests.)
 *
 *  - NO SILENT LOSS. A missing/uncached channel used to be reported as
 *    "delivered" (so the request vanished for good). The channel is now
 *    fetched if it isn't cached, and if it still can't be reached the send
 *    counts as a failure and goes through the normal retry/backoff.
 *
 *  - EMBED DIAGNOSTICS. If Discord accepts the message but drops the embed
 *    (bot lacks "Embed Links" in the channel — you then see the @role ping
 *    with nothing under it), a clear warning is logged, and missing
 *    View/Send/Embed permissions are reported before the send.
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

import { ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits } from "discord.js";
import { CONFIG, getChannelIdForOperator } from "./config.js";
import { getPendingRequests, getCodeSubmittedRequests, getPollingSeed } from "./database.js";
import { buildNewRequestEmbed, buildCodeSubmittedEmbed } from "./utils/embedBuilder.js";
import { getClaimer } from "./utils/claimStore.js";
import { rememberMessage } from "./utils/messageStore.js";
import { buildRequestPing, sendNewRequestDmAlerts } from "./utils/pings.js";
import { getLang } from "./utils/userPrefs.js";
import { t } from "./utils/i18n.js";
import { broadcastNewRequest, broadcastRequestUpdate } from "./web/broadcast.js";

const POLL_INTERVAL_MS     = 5_000;
const MAX_POLL_BACKOFF_MS  = 30_000;
const DELIVERED_TTL_MS     = 15 * 60_000;
const GIVE_UP_AFTER_MS     = 30 * 60_000;
const MAX_ROW_RETRY_MS     = 60_000;
const ERROR_LOG_EVERY_MS   = 30_000;

// ─── State ────────────────────────────────────────────────────────────────────

/** Seeded from the database (see initCursors) — never from the bot host's clock. */
let lastPendingAt       = new Date(0);
let lastCodeSubmittedAt = new Date(0);
let cursorsReady        = false;

/**
 * Seeds both cursors from the newest updated_at already in snap_requests.
 * That value comes from the very same column the poll queries compare
 * against, so it is correct whatever time zone the site / the bot's DB
 * session / the DB server use. Throws if the database can't be reached — the
 * poll loop just tries again on its next tick (nothing is polled until then).
 */
async function initCursors() {
    const seed  = await getPollingSeed();
    const start = seed.latest || new Date(0);

    lastPendingAt       = start;
    lastCodeSubmittedAt = start;
    cursorsReady        = true;

    const iso = (d) => d.toISOString().replace("T", " ").replace("Z", "");
    console.log(
        `🕒 Polling seeded — DB session tz: ${seed.tz} · NOW(): ${iso(seed.dbNow)} · UTC: ${iso(seed.dbUtc)} · ` +
        `newest updated_at: ${seed.latest ? iso(seed.latest) : "(table empty)"}`
    );

    const skewMs = seed.dbNow.getTime() - seed.dbUtc.getTime();
    if (Math.abs(skewMs) > 1_500) {
        console.warn(
            `⚠️  The bot's DB session is ${(skewMs / 3_600_000).toFixed(1)} h away from UTC — its "SET time_zone = '+00:00'" is not taking effect ` +
            `(is the deployed database.js the current one?). Polling no longer depends on it, but timestamps written by the bot ` +
            `(bot_* tables, staff_preferences) will be offset from the site's.`
        );
    }
}

/** "kind:phone:updatedAtMs" -> time it was delivered. Prevents re-sending. */
const delivered = new Map();
/** "kind:phone:updatedAtMs" -> { count, firstAt, nextAt }. Drives per-row backoff. */
const retryState = new Map();
/** Channels we already warned about missing permissions (warn once, not on every request). */
const warnedPerms = new Set();

let consecutiveFailedTicks = 0;
let lastErrorLogAt         = 0;
let suppressedErrors       = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function rowKey(kind, row) {
    return `${kind}:${row.phone}:${new Date(row.updated_at).getTime()}`;
}

/**
 * Resolve the right channel for a request based on its carrier
 * (Orange/SFR/Bouygues/Belgium). Falls back to fetching the channel from
 * Discord when it isn't in the cache, instead of giving up right away.
 */
async function resolveChannel(client, operator) {
    const channelId = getChannelIdForOperator(operator);
    if (!channelId) {
        console.warn(`⚠️  No channel configured for operator "${operator}" and no default channel set — use /config`);
        return null;
    }
    let channel = client.channels.cache.get(channelId);
    if (!channel) {
        try {
            channel = await client.channels.fetch(channelId);
        } catch (e) {
            console.warn(`⚠️  Configured channel ${channelId} for operator "${operator}" could not be fetched (wrong ID, or the bot can't see that channel): ${e.message}`);
            return null;
        }
    }
    return channel || null;
}

/** Logs (once per channel) which of View / Send / Embed Links the bot is missing there. */
function checkChannelPermissions(client, channel) {
    if (warnedPerms.has(channel.id)) return;
    try {
        const me    = channel.guild?.members?.me;
        const perms = me ? channel.permissionsFor(me) : null;
        if (!perms) return;
        const missing = perms.missing([
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.EmbedLinks,
        ]);
        if (missing.length > 0) {
            warnedPerms.add(channel.id);
            console.warn(`⚠️  Bot is missing permission(s) in #${channel.name} (${channel.id}): ${missing.join(", ")} — without "EmbedLinks" Discord posts the message text but silently drops every embed.`);
        }
    } catch { /* diagnostics only */ }
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
    const channel = await resolveChannel(client, row.operator);
    // Not reachable right now → a FAILURE (retried with backoff, abandoned
    // after 30 min), not a success: reporting success here made the request
    // disappear for good.
    if (!channel) return false;

    checkChannelPermissions(client, channel);

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
        broadcastNewRequest(row);

        if (sent.embeds.length === 0) {
            console.warn(`⚠️  Message ${sent.id} for ${row.phone} was posted WITHOUT its embed — the bot almost certainly lacks the "Embed Links" permission in #${channel.name} (${channel.id}).`);
        }

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
            broadcastRequestUpdate(row);
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
    const channel = await resolveChannel(client, row.operator);
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
        broadcastRequestUpdate(row);
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
        const key   = rowKey(kind, row);
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
 *
 * Nothing is polled until the cursors have been seeded from the database
 * (retried on every tick until it works).
 */
export function startPolling(client) {
    console.log(`🔄 Polling started — interval: ${POLL_INTERVAL_MS / 1000}s (no overlap, backs off up to ${MAX_POLL_BACKOFF_MS / 1000}s on errors)`);

    const loop = async () => {
        try {
            if (!cursorsReady) await initCursors();
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
    loop();
}
