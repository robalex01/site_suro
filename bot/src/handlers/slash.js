/**
 * slash.js — Slash command handler
 *
 * Improvements:
 *  - Uses centralized callStaffAction / callBanIP from utils/api.js
 *  - All commands use try/catch with descriptive error messages
 *  - Dynamic import of EmbedBuilder removed (was only needed for /today)
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
} from "../database.js";
import {
    buildStatsEmbed,
    buildOperatorStatsEmbed,
    buildLeaderboardEmbed,
    buildHourlyStatsEmbed,
    buildStaffActivityEmbed,
    buildPanelEmbed,
} from "../utils/embedBuilder.js";
import { callStaffAction, callBanIP } from "../utils/api.js";
import { isStaff } from "../utils/permissions.js";
import { getLang } from "../utils/userPrefs.js";
import { t } from "../utils/i18n.js";

export async function handleSlash(interaction) {
    const { commandName } = interaction;

    // The caller's own language. A slash reply is a direct answer to the
    // person who typed the command, so it follows their preference — unlike
    // the request embeds in the operator channels, which the whole team
    // reads and therefore stay in one shared language.
    const lang = await getLang(interaction.user.id);

    // Every command is staff/owner-only — this bot has no commands meant
    // for general server members. isStaff() also returns true for OWNER.
    if (!isStaff(interaction.member)) {
        await interaction.reply({ content: t(lang, "no_permission_command"), flags: 64 });
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
            });
        } else {
            // Default / fallback channel (used for any operator without a dedicated channel)
            process.env.DISCORD_LOG_CHANNEL_ID = channel.id;
            CONFIG.LOG_CHANNEL_ID = channel.id;
            await interaction.reply({
                content: t(lang, "config_default_channel", `<#${channel.id}>`),
                flags: 64,
            });
        }
        return;
    }

    // ─── PANEL ────────────────────────────────────────────────────────────────
    if (commandName === "panel") {
        const embed = buildPanelEmbed();
        await interaction.reply({ embeds: [embed] });
        return;
    }

    // ─── CLAIM ────────────────────────────────────────────────────────────────
    if (commandName === "claim") {
        const phone = interaction.options.getString("phone");
        await interaction.deferReply();
        try {
            const data = await callStaffAction("claim", phone, interaction.user.tag);
            await interaction.editReply({
                content: data.success ? "✅ " + data.message : "❌ " + data.message,
            });
        } catch (e) {
            await interaction.editReply({ content: t(lang, "err_network", e.message) });
        }
        return;
    }

    // ─── SET LENGTH ───────────────────────────────────────────────────────────
    if (commandName === "setlength") {
        const phone  = interaction.options.getString("phone");
        const length = interaction.options.getInteger("length");
        await interaction.deferReply();
        try {
            const data = await callStaffAction("set_length", phone, interaction.user.tag, length);
            await interaction.editReply({
                content: data.success ? "✅ " + data.message : "❌ " + data.message,
            });
        } catch (e) {
            await interaction.editReply({ content: t(lang, "err_network", e.message) });
        }
        return;
    }

    // ─── WRONG NUMBER ─────────────────────────────────────────────────────────
    if (commandName === "wrongnumber") {
        const phone = interaction.options.getString("phone");
        await interaction.deferReply();
        try {
            const data = await callStaffAction("wrong_number", phone, interaction.user.tag);
            await interaction.editReply({
                content: data.success ? "✅ " + data.message : "❌ " + data.message,
            });
        } catch (e) {
            await interaction.editReply({ content: t(lang, "err_network", e.message) });
        }
        return;
    }

    // ─── BAN IP ───────────────────────────────────────────────────────────────
    if (commandName === "banip") {
        const ip = interaction.options.getString("ip");
        await interaction.deferReply();
        try {
            const data = await callBanIP(ip, interaction.user.tag);
            await interaction.editReply({
                content: data.success ? "🚫 " + data.message : "❌ " + data.message,
            });
        } catch (e) {
            await interaction.editReply({ content: t(lang, "err_network", e.message) });
        }
        return;
    }

    // ─── STATS ────────────────────────────────────────────────────────────────
    if (commandName === "stats") {
        await interaction.deferReply();
        try {
            const [stats, today] = await Promise.all([getGlobalStats(), getTodayStats()]);
            await interaction.editReply({ embeds: [buildStatsEmbed(stats, today, lang)] });
        } catch (e) {
            console.error("Stats error:", e);
            await interaction.editReply({ content: t(lang, "err_fetch") });
        }
        return;
    }

    // ─── TODAY ────────────────────────────────────────────────────────────────
    if (commandName === "today") {
        await interaction.deferReply();
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
            await interaction.editReply({ content: t(lang, "err_fetch") });
        }
        return;
    }

    // ─── OPERATORS ────────────────────────────────────────────────────────────
    if (commandName === "operators") {
        await interaction.deferReply();
        try {
            const opStats = await getOperatorStats();
            await interaction.editReply({ embeds: [buildOperatorStatsEmbed(opStats, lang)] });
        } catch (e) {
            console.error("Operators error:", e);
            await interaction.editReply({ content: t(lang, "err_fetch") });
        }
        return;
    }

    // ─── ACTIVITY ─────────────────────────────────────────────────────────────
    if (commandName === "activity") {
        await interaction.deferReply();
        try {
            const hourly = await getHourlyStats();
            await interaction.editReply({ embeds: [buildHourlyStatsEmbed(hourly, lang)] });
        } catch (e) {
            console.error("Activity error:", e);
            await interaction.editReply({ content: t(lang, "err_fetch") });
        }
        return;
    }

    // ─── LEADERBOARD ──────────────────────────────────────────────────────────
    if (commandName === "leaderboard") {
        const limit = interaction.options.getInteger("limit") || 10;
        await interaction.deferReply();
        try {
            const rows = await getStaffLeaderboard(limit);
            await interaction.editReply({ embeds: [buildLeaderboardEmbed(rows, limit, lang)] });
        } catch (e) {
            console.error("Leaderboard error:", e);
            await interaction.editReply({ content: t(lang, "err_fetch") });
        }
        return;
    }

    // ─── STAFF ACTIVITY ───────────────────────────────────────────────────────
    if (commandName === "staffactivity") {
        await interaction.deferReply();
        try {
            const activity = await getStaffActivity();
            await interaction.editReply({ embeds: [buildStaffActivityEmbed(activity, lang)] });
        } catch (e) {
            console.error("Staff activity error:", e);
            await interaction.editReply({ content: t(lang, "err_fetch") });
        }
        return;
    }
}
