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

export async function handleSlash(interaction) {
    const { commandName } = interaction;

    // ─── CONFIG ───────────────────────────────────────────────────────────────
    if (commandName === "config") {
        const channel = interaction.options.getChannel("channel");
        // Persist in process.env for this session (use a real store for multi-restart)
        process.env.DISCORD_LOG_CHANNEL_ID = channel.id;
        CONFIG.LOG_CHANNEL_ID = channel.id;
        await interaction.reply({
            content: `✅ Log channel set to <#${channel.id}>`,
            flags: 64,
        });
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
            await interaction.editReply({ content: "❌ Network error: " + e.message });
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
            await interaction.editReply({ content: "❌ Network error: " + e.message });
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
            await interaction.editReply({ content: "❌ Network error: " + e.message });
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
            await interaction.editReply({ content: "❌ Network error: " + e.message });
        }
        return;
    }

    // ─── STATS ────────────────────────────────────────────────────────────────
    if (commandName === "stats") {
        await interaction.deferReply();
        try {
            const [stats, today] = await Promise.all([getGlobalStats(), getTodayStats()]);
            await interaction.editReply({ embeds: [buildStatsEmbed(stats, today)] });
        } catch (e) {
            console.error("Stats error:", e);
            await interaction.editReply({ content: "❌ Error fetching stats" });
        }
        return;
    }

    // ─── TODAY ────────────────────────────────────────────────────────────────
    if (commandName === "today") {
        await interaction.deferReply();
        try {
            const today = await getTodayStats();
            const embed = new EmbedBuilder()
                .setTitle("📅 Today's Statistics")
                .setColor(0x10b981)
                .addFields(
                    { name: "📋 Requests Today",  value: "`" + today.requests  + "`", inline: true },
                    { name: "✅ Completed Today", value: "`" + today.completed + "`", inline: true }
                )
                .setFooter({ text: "📅 Snaptech Today" })
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
        } catch (e) {
            console.error("Today error:", e);
            await interaction.editReply({ content: "❌ Error fetching today's stats" });
        }
        return;
    }

    // ─── OPERATORS ────────────────────────────────────────────────────────────
    if (commandName === "operators") {
        await interaction.deferReply();
        try {
            const opStats = await getOperatorStats();
            await interaction.editReply({ embeds: [buildOperatorStatsEmbed(opStats)] });
        } catch (e) {
            console.error("Operators error:", e);
            await interaction.editReply({ content: "❌ Error fetching operator stats" });
        }
        return;
    }

    // ─── ACTIVITY ─────────────────────────────────────────────────────────────
    if (commandName === "activity") {
        await interaction.deferReply();
        try {
            const hourly = await getHourlyStats();
            await interaction.editReply({ embeds: [buildHourlyStatsEmbed(hourly)] });
        } catch (e) {
            console.error("Activity error:", e);
            await interaction.editReply({ content: "❌ Error fetching activity" });
        }
        return;
    }

    // ─── LEADERBOARD ──────────────────────────────────────────────────────────
    if (commandName === "leaderboard") {
        const limit = interaction.options.getInteger("limit") || 10;
        await interaction.deferReply();
        try {
            const rows = await getStaffLeaderboard(limit);
            await interaction.editReply({ embeds: [buildLeaderboardEmbed(rows, limit)] });
        } catch (e) {
            console.error("Leaderboard error:", e);
            await interaction.editReply({ content: "❌ Error fetching leaderboard" });
        }
        return;
    }

    // ─── STAFF ACTIVITY ───────────────────────────────────────────────────────
    if (commandName === "staffactivity") {
        await interaction.deferReply();
        try {
            const activity = await getStaffActivity();
            await interaction.editReply({ embeds: [buildStaffActivityEmbed(activity)] });
        } catch (e) {
            console.error("Staff activity error:", e);
            await interaction.editReply({ content: "❌ Error fetching staff activity" });
        }
        return;
    }
}
