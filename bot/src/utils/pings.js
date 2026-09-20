/**
 * pings.js — new-request channel ping + personal DM alert
 *
 * buildRequestPing() pings the ACCESS ROLE (@role), notifying everyone who
 * has it. It does NOT enumerate individual members — Discord's
 * allowed_mentions can only SUPPRESS a mention already in the message text,
 * it can't selectively notify someone whose ID never appears in the
 * content. So "show @Role but only notify some of its members" isn't
 * something Discord supports; the only real choices are "ping the role"
 * (everyone) or "list people individually" (heavier, needs the members
 * intent, and was tried and reverted before — see git history).
 *
 * sendNewRequestDmAlerts() is the separate, OPT-IN personal alert: staff
 * who enabled it (the "DM Alert" toggle in /panel settings — this reuses
 * the receive_pings column/button, renamed in the UI) get a private DM on
 * every new request, on top of the role ping, optionally filtered to only
 * the operators they care about and pausable with "snooze".
 */

import { EmbedBuilder } from "discord.js";
import { CONFIG, getOperatorGroup } from "../config.js";
import { getDmAlertCandidates } from "../database.js";
import { t } from "./i18n.js";

/**
 * Builds the `content` + `allowedMentions` for a new-request message.
 *
 * CONFIG.PING_MESSAGE (DISCORD_PING_MESSAGE in .env) overrides this
 * entirely when set — e.g. "@here" or a different role. Otherwise pings
 * the configured access role.
 *
 * @returns {{content: string, allowedMentions: object}}
 */
export function buildRequestPing() {
    return {
        content: CONFIG.PING_MESSAGE || `<@&${CONFIG.ACCESS_ROLE_ID}>`,
        allowedMentions: { roles: [CONFIG.ACCESS_ROLE_ID] },
    };
}

/**
 * No-op, kept for backward compatibility.
 *
 * An older version of this file cached per-member ping resolution in
 * memory (hence the name) and needed an explicit cache-bust whenever a
 * staff member changed their preference. That approach was dropped in
 * favour of the plain @role ping above plus the live-query DM alert below
 * — there is nothing left to invalidate, since getDmAlertCandidates() hits
 * the DB fresh every time it's called. staffConfig.js still calls this
 * after every preference change though, so it stays exported as a no-op
 * rather than making that call site special-case its removal.
 */
export function invalidatePingCache() {}

function isSnoozed(snoozeUntil) {
    return !!snoozeUntil && new Date(snoozeUntil).getTime() > Date.now();
}

/** null/empty dm_alert_operators means "all operators" — everything matches. */
function matchesOperatorFilter(dmAlertOperators, operator) {
    if (!dmAlertOperators) return true;
    const allowed = dmAlertOperators.split(",").map(s => s.trim()).filter(Boolean);
    if (allowed.length === 0) return true;
    return allowed.includes(getOperatorGroup(operator));
}

/**
 * Personal "new request" DM alert — opt-in, on top of the @role ping in the
 * channel. Best-effort and non-blocking by design: called fire-and-forget
 * from polling.js right after the channel embed is posted, so a slow or
 * failing DM here never delays the channel post or stalls the poll cursor.
 * A failure to reach one candidate (DMs closed, invalid user, etc.) is
 * logged and skipped — it never blocks the others.
 */
export async function sendNewRequestDmAlerts(client, row, channel) {
    let candidates;
    try {
        candidates = await getDmAlertCandidates();
    } catch (e) {
        console.warn("⚠️  Could not load DM-alert candidates:", e.message);
        return;
    }

    for (const candidate of candidates) {
        if (isSnoozed(candidate.snooze_until)) continue;
        if (!matchesOperatorFilter(candidate.dm_alert_operators, row.operator)) continue;

        const lang = candidate.language || "en";
        try {
            const user = await client.users.fetch(candidate.discord_user_id);
            const embed = new EmbedBuilder()
                .setTitle(t(lang, "dm_alert_title"))
                .setColor(0x3b82f6)
                .setDescription(t(lang, "dm_alert_desc", channel ? `<#${channel.id}>` : "the request channel"))
                .setTimestamp();
            await user.send({ embeds: [embed] });
        } catch (e) {
            console.warn(`⚠️  Could not send DM alert to ${candidate.discord_user_id}:`, e.message);
        }
    }
}
