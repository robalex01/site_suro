import { CONFIG } from "../config.js";
import { sql, getGlobalStats, getTodayStats, getOperatorStats, getHourlyStats, getStaffLeaderboard, getStaffActivity } from "../database.js";
import { buildStatsEmbed, buildOperatorStatsEmbed, buildLeaderboardEmbed, buildHourlyStatsEmbed, buildStaffActivityEmbed, buildPanelEmbed } from "../utils/embedBuilder.js";

async function callStaffAPI(action, phone, length, staffTag) {
    const body = { action, phone, secret: CONFIG.STAFF_SECRET, staff_tag: staffTag };
    if (length) body.length = length;
    const res = await fetch(CONFIG.API_BASE + "/api/staff-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    });
    return res.json();
}

export async function handleSlash(interaction) {
    if (interaction.commandName === "config") {
        const channel = interaction.options.getChannel("channel");
        process.env.DISCORD_LOG_CHANNEL_ID = channel.id;
        await interaction.reply({ content: "✅ Log channel set to <#" + channel.id + ">", flags: 64 });
    }

    if (interaction.commandName === "panel") {
        const embed = buildPanelEmbed();
        await interaction.reply({ embeds: [embed] });
    }

    if (interaction.commandName === "claim") {
        const phone = interaction.options.getString("phone");
        await interaction.deferReply();
        try {
            const data = await callStaffAPI("claim", phone, null, interaction.user.tag);
            await interaction.editReply({ content: data.success ? "✅ " + data.message : "❌ " + data.message });
        } catch (e) { await interaction.editReply({ content: "❌ Error" }); }
    }

    if (interaction.commandName === "setlength") {
        const phone = interaction.options.getString("phone");
        const length = interaction.options.getInteger("length");
        await interaction.deferReply();
        try {
            const data = await callStaffAPI("set_length", phone, length, interaction.user.tag);
            await interaction.editReply({ content: data.success ? "✅ " + data.message : "❌ " + data.message });
        } catch (e) { await interaction.editReply({ content: "❌ Error" }); }
    }

    if (interaction.commandName === "wrongnumber") {
        const phone = interaction.options.getString("phone");
        await interaction.deferReply();
        try {
            const data = await callStaffAPI("wrong_number", phone, null, interaction.user.tag);
            await interaction.editReply({ content: data.success ? "✅ " + data.message : "❌ " + data.message });
        } catch (e) { await interaction.editReply({ content: "❌ Error" }); }
    }

    if (interaction.commandName === "banip") {
        const ip = interaction.options.getString("ip");
        await interaction.deferReply();
        try {
            const res = await fetch(CONFIG.API_BASE + "/api/ban-ip", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ip, secret: CONFIG.STAFF_SECRET, banned_by: interaction.user.tag })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? "🚫 " + data.message : "❌ " + data.message });
        } catch (e) { await interaction.editReply({ content: "❌ Error" }); }
    }

    // ─── STATS ───
    if (interaction.commandName === "stats") {
        await interaction.deferReply();
        try {
            const stats = await getGlobalStats();
            const today = await getTodayStats();
            const embed = buildStatsEmbed(stats, today);
            await interaction.editReply({ embeds: [embed] });
        } catch (e) { 
            console.error("Stats error:", e);
            await interaction.editReply({ content: "❌ Error fetching stats" }); 
        }
    }

    // ─── TODAY ───
    if (interaction.commandName === "today") {
        await interaction.deferReply();
        try {
            const today = await getTodayStats();
            const embed = new (await import("discord.js")).EmbedBuilder()
                .setTitle("📅 Today's Statistics")
                .setColor(0x10b981)
                .addFields(
                    { name: "📋 Requests Today", value: "`" + today.requests + "`", inline: true },
                    { name: "✅ Completed Today", value: "`" + today.completed + "`", inline: true }
                )
                .setFooter({ text: "📅 Snaptech Today" })
                .setTimestamp();
            await interaction.editReply({ embeds: [embed] });
        } catch (e) { 
            console.error("Today error:", e);
            await interaction.editReply({ content: "❌ Error fetching today's stats" }); 
        }
    }

    // ─── OPERATORS ───
    if (interaction.commandName === "operators") {
        await interaction.deferReply();
        try {
            const opStats = await getOperatorStats();
            const embed = buildOperatorStatsEmbed(opStats);
            await interaction.editReply({ embeds: [embed] });
        } catch (e) { 
            console.error("Operators error:", e);
            await interaction.editReply({ content: "❌ Error fetching operator stats" }); 
        }
    }

    // ─── ACTIVITY ───
    if (interaction.commandName === "activity") {
        await interaction.deferReply();
        try {
            const hours = interaction.options.getInteger("hours") || 24;
            const hourly = await getHourlyStats();
            const embed = buildHourlyStatsEmbed(hourly);
            await interaction.editReply({ embeds: [embed] });
        } catch (e) { 
            console.error("Activity error:", e);
            await interaction.editReply({ content: "❌ Error fetching activity" }); 
        }
    }

    // ─── LEADERBOARD ───
    if (interaction.commandName === "leaderboard") {
        await interaction.deferReply();
        try {
            const limit = interaction.options.getInteger("limit") || 10;
            const rows = await getStaffLeaderboard(limit);
            const embed = buildLeaderboardEmbed(rows, limit);
            await interaction.editReply({ embeds: [embed] });
        } catch (e) { 
            console.error("Leaderboard error:", e);
            await interaction.editReply({ content: "❌ Error fetching leaderboard" }); 
        }
    }

    // ─── STAFF ACTIVITY ───
    if (interaction.commandName === "staffactivity") {
        await interaction.deferReply();
        try {
            const activity = await getStaffActivity();
            const embed = buildStaffActivityEmbed(activity);
            await interaction.editReply({ embeds: [embed] });
        } catch (e) { 
            console.error("Staff activity error:", e);
            await interaction.editReply({ content: "❌ Error fetching staff activity" }); 
        }
    }
}
