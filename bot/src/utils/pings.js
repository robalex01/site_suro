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
 * who enabled it (the "DM Alert" toggle in the settings panel — this reuses
 * the receive_pings column/button, renamed in the UI) get a private DM on
 * every new request, on top of the role ping, optionally filtered to only
 * the operators they care about and pausable with "snooze".
 *
 * v2 — reliability (from the production console):
 *  - Recipients now come from the in-memory preferences snapshot
 *    (userPrefs.js) instead of a database query per new request. The
 *    console showed "Could not load DM-alert candidates: fetch failed" —
 *    a DB blip used to mean nobody got their alert. The DB is only asked
 *    as a fallback when the snapshot hasn't loaded yet.
 *  - DMs go out in parallel (5 at a time) instead of one after another: a
 *    single "Connect Timeout ... 10000ms" used to hold up every staff
 *    member queued behind it by 10 seconds.
 *  - One retry (after 1.5s) on network/timeout errors. Closed DMs (50007)
 *    are not retried.
 */

import { EmbedBuilder } from "discord.js";
import { CONFIG, getOperatorGroup } from "../config.js";
import { getDmAlertCandidates } from "../database.js";
import { isSnapshotLoaded, listPersistedPrefs } from "./userPrefs.js";
import { t } from "./i18n.js";

const DM_CONCURRENCY = 5;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
 * staff member changed their preference. That approach was dropped; the
 * preference cache in userPrefs.js is written through on every change, so
 * there is nothing left to invalidate here. staffConfig.js still calls this
 * after preference changes, so it stays exported as a no-op.
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

function isTransientSendError(e) {
    const text = [e?.message, e?.code, e?.cause?.code].filter(Boolean).join(" ");
    return /timeout|timed out|ETIMEDOUT|ECONNRESET|EAI_AGAIN|fetch failed|socket|UND_ERR/i.test(text);
}

/** Everyone with the DM alert turned on: memory first, database only if the snapshot isn't loaded yet. */
async function loadRecipients() {
    if (isSnapshotLoaded()) {
        return listPersistedPrefs().filter(p => p.receive_pings);
    }
    try {
        return await getDmAlertCandidates();
    } catch (e) {
        console.warn("⚠️  Could not load DM-alert candidates:", e.message);
        return [];
    }
}

async function sendOneAlert(client, candidate, channel) {
    const lang = candidate.language || "en";
    const embed = new EmbedBuilder()
        .setTitle(t(lang, "dm_alert_title"))
        .setColor(0x3b82f6)
        .setDescription(t(lang, "dm_alert_desc", `<#${channel.id}>`))
        .setTimestamp();

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const user = await client.users.fetch(candidate.discord_user_id);
            await user.send({ embeds: [embed] });
            return;
        } catch (e) {
            if (e?.code === 50007) {
                console.warn(`⚠️  DM alert skipped for ${candidate.discord_user_id}: their DMs are closed.`);
                return;
            }
            if (attempt === 0 && isTransientSendError(e)) {
                await sleep(1500);
                continue;
            }
            console.warn(`⚠️  Could not send DM alert to ${candidate.discord_user_id}:`, e.message);
            return;
        }
    }
}

/**
 * Personal "new request" DM alert — opt-in, on top of the @role ping in the
 * channel. Best-effort and non-blocking by design: called fire-and-forget
 * from polling.js right after the channel embed is posted, so a slow or
 * failing DM here never delays the channel post or stalls the poll cursor.
 */
export async function sendNewRequestDmAlerts(client, row, channel) {
    if (!channel) return;

    const recipients = (await loadRecipients()).filter(c =>
        !isSnoozed(c.snooze_until) && matchesOperatorFilter(c.dm_alert_operators, row.operator)
    );
    if (recipients.length === 0) return;

    for (let i = 0; i < recipients.length; i += DM_CONCURRENCY) {
        const batch = recipients.slice(i, i + DM_CONCURRENCY);
        await Promise.all(batch.map(c => sendOneAlert(client, c, channel)));
    }
}
