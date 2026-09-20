/**
 * dailySummary.js — opt-in personal "your day, in short" DM
 *
 * Runs on a coarse timer (every 15 min) rather than a precise once-a-day
 * schedule: checking often and guarding with last_summary_sent_date
 * (database.js) is simpler and more restart-safe than a single setTimeout
 * aimed at one exact instant — a bot restart never causes a missed or
 * duplicate send. 15 minutes of slop around CONFIG.DAILY_SUMMARY_HOUR_UTC
 * is not something anyone will notice for an end-of-day recap.
 *
 * Best-effort throughout: a failure to DM one candidate, or to load their
 * stats, is logged and skipped — it never blocks the others or crashes the
 * tick.
 */

import { EmbedBuilder } from "discord.js";
import { CONFIG } from "./config.js";
import { getDailySummaryCandidates, getDailySummaryActionCounts, markDailySummarySent } from "./database.js";
import { t } from "./utils/i18n.js";

const CHECK_INTERVAL_MS = 15 * 60_000;

async function runDailySummaryTick(client) {
    const hour = new Date().getUTCHours();
    if (hour !== CONFIG.DAILY_SUMMARY_HOUR_UTC) return;

    let candidates;
    try {
        candidates = await getDailySummaryCandidates();
    } catch (e) {
        console.warn("⚠️  Could not load daily-summary candidates:", e.message);
        return;
    }
    if (candidates.length === 0) return;

    for (const candidate of candidates) {
        const lang = candidate.language || "en";
        try {
            // snap_logs.details keys actions by Discord TAG, not ID (see
            // database.js) — resolve the user's current tag to look theirs up,
            // same convention as the "My stats" / "My history" panel buttons.
            const user = await client.users.fetch(candidate.discord_user_id);
            const rows = await getDailySummaryActionCounts(user.tag);
            const counts = {};
            rows.forEach(r => { counts[r.action] = Number(r.count); });

            const embed = new EmbedBuilder()
                .setTitle(t(lang, "daily_summary_title"))
                .setColor(0x3b82f6)
                .setDescription(t(lang, "daily_summary_line", counts.claim || 0, counts.true_code || 0, counts.false_code || 0))
                .setFooter({ text: t(lang, "daily_summary_footer") })
                .setTimestamp();

            await user.send({ embeds: [embed] });
            await markDailySummarySent(candidate.discord_user_id);
        } catch (e) {
            console.warn(`⚠️  Could not send daily summary to ${candidate.discord_user_id}:`, e.message);
        }
    }
}

export function startDailySummarySchedule(client) {
    console.log(`🌙 Daily summary schedule started — checking every ${CHECK_INTERVAL_MS / 60_000}min, sends around ${CONFIG.DAILY_SUMMARY_HOUR_UTC}:00 UTC`);
    setInterval(() => {
        runDailySummaryTick(client).catch(e => console.error("❌ Daily summary tick error:", e.message || e));
    }, CHECK_INTERVAL_MS);
}
