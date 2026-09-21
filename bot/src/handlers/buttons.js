/**
 * buttons.js — Discord button interaction handler  (v2.8)
 *
 * v2.8 — Ban IP button removed + latency pass (driven by the production console):
 *  - The "🚫 Ban IP" button is GONE from every embed (post-claim, unclaim,
 *    code-submitted DM). Banning is now only possible through the /banip
 *    slash command, which is restricted to the Owner role (slash.js).
 *    Old messages still on screen may carry a stale Ban IP button; clicking
 *    it now gets a short explanation instead of doing anything.
 *  - safeDefer no longer wastes time on a dead token or waits 15s on a hung
 *    connection. Discord kills an interaction token 3s after it was created:
 *      • if the interaction is already ≥2.9s old when we get it (the console
 *        showed 8.7s and 45s old ones), we skip the REST call entirely — it
 *        can only fail, and each doomed call competed for the same struggling
 *        connection as the live ones;
 *      • otherwise the defer is raced against the time REMAINING in that 3s
 *        window, instead of the old behaviour of waiting out the full REST
 *        timeout ("Could not defer ... after 15704ms of trying" on an
 *        interaction that was only 133ms old).
 *    Either way the underlying action still runs (that's the user's real
 *    intent); a late-landing defer is still picked up by safeReply.
 *  - Fewer database round-trips per click. Ban IP is gone, so unclaim and
 *    "false code" no longer need to look up the request row just to find its
 *    IP. Claim still reads the row (operator colour + username for the private
 *    confirmation) but now survives that read failing instead of turning a
 *    successful claim into a bogus "network error".
 *  - API messages (which the server always writes in French) are translated
 *    into the clicker's language via tApi().
 *  - Anything unrecognised now answers instead of leaving a deferred reply
 *    hanging on "thinking…".
 *
 * v2.7 — Cache-miss-safe message edits: safeEditMessage takes the client and
 * retries via an explicit channel/message fetch if `message.edit()` fails
 * with "Could not find the channel where this message came from in the cache".
 *
 * v2.6 — Permissions + cross-context refresh: every button requires the STAFF
 * role (OWNER implies it), checked only for guild interactions (the
 * True/False Code buttons live in the claimer's DM, which has no member
 * data, so those rely on the claimer-only lock). OWNER bypasses the
 * claimer-only lock. True/False Code also refresh the ORIGINAL channel embed
 * via messageStore, not just the DM.
 *
 * v2.5 — Interaction-safety: deferReply/editReply/reply are always wrapped;
 * ack first, DB permission check after; in-memory fast-path on "claim";
 * shared claimStore.
 *
 * v2.4 — Ping routing: new request pings @access; every later embed pings the
 * claimer; unclaim pings @access again.
 *
 * v2.3 — False code edits the message in place back to [4/6 · Wrong · Unclaim].
 * v2.2 — claimer-only buttons. v2.1 — length param, double-claim protection.
 */

import {
    ButtonBuilder, ButtonStyle,
    ActionRowBuilder, EmbedBuilder,
} from "discord.js";
import { CONFIG }                                       from "../config.js";
import { getRequestByPhone }                             from "../database.js";
import { getOperatorColor }                               from "../utils/colors.js";
import { formatPhone }                                    from "../utils/formatters.js";
import { callStaffAction }                                from "../utils/api.js";
import { setClaimer, clearClaimer, getClaimer, peekClaimer } from "../utils/claimStore.js";
import { recallMessage, forgetMessage }                  from "../utils/messageStore.js";
import { isStaff, isOwner }                               from "../utils/permissions.js";
import { getLang, peekLang }                               from "../utils/userPrefs.js";
import { t, tApi }                                         from "../utils/i18n.js";
import { broadcastRequestUpdate, broadcastRequestRemoved }  from "../web/broadcast.js";

// WHAT IS AND ISN'T TRANSLATED IN THIS FILE
//   Translated  — every ephemeral reply (safeReply) and the DM embeds, since
//                 those are delivered to exactly one person: the clicker.
//   NOT translated — the channel embeds edited via safeEditMessage and
//                 refreshChannelMessage. Those are shared messages the whole
//                 team reads; Discord shows one message identically to every
//                 viewer, so translating them into the clicker's language
//                 would impose that language on everyone else.
//
// Language comes from userPrefs.js, which is an in-memory snapshot: getLang
// is now instant and never touches the database, so it no longer matters
// whether it runs before or after the defer.

// ─── Interaction-safety helpers ───────────────────────────────────────────────

// Discord invalidates an interaction token 3000ms after the interaction was
// created. Stay a little under that: a defer that would land at 2.95s is a
// coin-flip, not a plan.
const ACK_DEADLINE_MS = 2900;

function withTimeout(promise, ms) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`no ack within ${ms}ms`)), ms); }),
    ]).finally(() => clearTimeout(timer));
}

/**
 * Defers the interaction (ephemeral) without ever throwing. Returns true if
 * the defer succeeded, false if the token was already dead or the call
 * didn't land in time — callers proceed with the underlying action either
 * way since that's the user's real intent and the channel embed is the real
 * feedback.
 */
async function safeDefer(interaction) {
    const start = Date.now();
    const ageMs = start - interaction.createdTimestamp;

    if (ageMs >= ACK_DEADLINE_MS) {
        console.warn(`⚠️  Skipping defer for ${interaction.id}: interaction already ${ageMs}ms old (token expired) — running the action anyway.`);
        return false;
    }

    try {
        await withTimeout(interaction.deferReply({ flags: 64 }), Math.max(300, ACK_DEADLINE_MS - ageMs));
        const tookMs = Date.now() - start;
        // Visible even on SUCCESS: >1000ms here means Discord REST latency
        // from this host is a real, ongoing problem.
        if (tookMs > 1000) {
            console.warn(`⏱️  deferReply for ${interaction.id} took ${tookMs}ms to succeed — Discord REST latency from this host is high.`);
        }
        return true;
    } catch (e) {
        console.warn(
            `⚠️  Could not defer interaction ${interaction.id} after ${Date.now() - start}ms ` +
            `(it was ${ageMs}ms old when we started): ${e.message}`
        );
        return false;
    }
}

/** Replies/edits without ever throwing — no-ops (with a log) if the token is dead. */
async function safeReply(interaction, deferred, options) {
    try {
        if (deferred || interaction.deferred || interaction.replied) {
            await interaction.editReply(options);
        } else {
            await interaction.reply({ ...options, flags: 64 });
        }
    } catch (e) {
        // A defer we gave up on may still have landed a moment later — one more chance.
        if (!deferred && interaction.deferred) {
            try { await interaction.editReply(options); return; } catch { /* fall through to the log */ }
        }
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

/** Returns the ActionRow used right after a claim (4/6 · Wrong · Unclaim). */
function buildPostClaimRow(phone) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("len4_"    + phone).setLabel("🔢 4 digits").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("len6_"    + phone).setLabel("🔢 6 digits").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("wrong_"   + phone).setLabel("❌ Wrong Number").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("unclaim_" + phone).setLabel("↩️ Unclaim").setStyle(ButtonStyle.Secondary),
    );
}

/**
 * Edit a message silently (stale interaction tokens don't crash the bot).
 *
 * `message.edit()` alone fails with "Could not find the channel where this
 * message came from in the cache!" whenever the parent channel isn't in
 * discord.js's cache — most commonly right after a bot restart, for a
 * channel nothing else has touched yet. When that happens, retry once via
 * an explicit fetch (client.channels.fetch + channel.messages.fetch), which
 * populates the cache on demand instead of just giving up. Only a genuine
 * failure after that retry (message actually deleted, missing permissions,
 * etc.) is logged and swallowed.
 */
async function safeEditMessage(client, message, options) {
    try {
        await message.edit(options);
        return;
    } catch (e) {
        console.warn(`⚠️  Could not edit message ${message.id} directly (${e.message}) — retrying via fetch…`);
    }
    try {
        const channel = await client.channels.fetch(message.channelId);
        const fresh   = await channel.messages.fetch(message.id);
        await fresh.edit(options);
    } catch (e2) {
        console.warn(`⚠️  Could not edit message ${message.id} even after refetching:`, e2.message);
    }
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
    let loc = null;
    try { loc = await recallMessage(phone); }
    catch (e) { console.warn(`⚠️  Could not look up the channel message for ${phone}:`, e.message); }
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

/**
 * Returns the claimer userId if the caller is NOT allowed, or null if allowed.
 * If the claimer lookup fails (database unreachable) we ALLOW the action:
 * the API's own atomic status guards reject anything that is genuinely
 * invalid, and blocking every staff member because of a DB hiccup is worse
 * than the small window this opens.
 */
async function getUnauthorizedClaimer(phone, userId) {
    let claimer = null;
    try { claimer = await getClaimer(phone); }
    catch (e) {
        console.warn(`⚠️  Could not verify claimer for ${phone} (allowing — the API enforces state): ${e.message}`);
        return null;
    }
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
        // Username is revealed only here, in the claimer's own ephemeral
        // reply — never written into the shared channel embed below.
        const claimedContent = row?.username
            ? `${t(lang, "claimed", formatPhone(phone), `<@${interaction.user.id}>`)}\n${t(lang, "claimed_username", row.username)}`
            : t(lang, "claimed", formatPhone(phone), `<@${interaction.user.id}>`);
        await safeReply(interaction, deferred, { content: claimedContent });
        const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(getOperatorColor(row?.operator))
            .setTitle("📋 Request In Progress")
            .setDescription(
                `👤 Claimed by <@${interaction.user.id}>\n` +
                `⏰ Claimed <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
                `**🔧 Choose an action:**`
            );
        await safeEditMessage(interaction.client, interaction.message, {
            content:    pingUser(interaction.user.id),
            embeds:     [newEmbed],
            components: [buildPostClaimRow(phone)],
        });
        return;
    }

    // apiMessage null means we got here from a network/timeout error rather
    // than a clean "already claimed" response from the API — word it as such
    // instead of claiming someone else holds it, which we don't actually know.
    await safeReply(interaction, deferred, {
        content: apiMessage
            ? "❌ " + tApi(lang, apiMessage)
            : (realClaimer ? t(lang, "already_claimed", `<@${realClaimer}>`) : t(lang, "network_error_claim")),
    });

    // Refresh the stale embed so future clicks don't repeat the same failure.
    if (row && realClaimer) {
        setClaimer(phone, realClaimer);
        const staleEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(getOperatorColor(row.operator))
            .setTitle("📋 Request In Progress")
            .setDescription(`👤 Already claimed by <@${realClaimer}>\n\n**🔧 Choose an action:**`);
        await safeEditMessage(interaction.client, interaction.message, {
            content:    pingUser(realClaimer),
            embeds:     [staleEmbed],
            components: [buildPostClaimRow(phone)],
        });
    } else if (row && row.status !== "pending") {
        // Not claimed by anyone, but not pending either (completed / wrong_number / etc.)
        const staleEmbed = EmbedBuilder.from(interaction.message.embeds[0])
            .setColor(0x6b7280)
            .setTitle("⚠️ Request No Longer Available")
            .setDescription(`This request's status is now \`${row.status}\` — it can no longer be claimed here.`);
        await safeEditMessage(interaction.client, interaction.message, { content: "", embeds: [staleEmbed], components: [] });
    }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function handleButton(interaction) {
    // Diagnostic: how old was this interaction by the time our code even saw
    // it? If this is already close to (or over) 3000ms, the delay is
    // upstream of us — gateway dispatch lag or the event loop being blocked
    // (see the event-loop monitor in bot.js) — and no amount of retrying
    // deferReply faster will fix it.
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
            // peekLang: memory only, nothing has acked this interaction yet.
            await interaction.reply({ content: t(peekLang(interaction.user.id), "no_permission"), flags: 64 });
        } catch (e) {
            console.warn(`⚠️  Could not send permission-denied reply for ${interaction.id}:`, e.message);
        }
        return;
    }

    const [action, ...rest] = interaction.customId.split("_");
    const payload = rest.join("_");
    const callerIsOwner = interaction.inGuild() && isOwner(interaction.member);

    // ══ LEGACY: the Ban IP button no longer exists ═══════════════════════════
    // Old messages already posted may still show it. Answer instead of
    // leaving the user staring at "This interaction failed".
    if (action === "banip") {
        try {
            await interaction.reply({ content: t(peekLang(interaction.user.id), "banip_button_removed"), flags: 64 });
        } catch (e) {
            console.warn(`⚠️  Could not answer legacy Ban IP button click ${interaction.id}:`, e.message);
        }
        return;
    }

    // ══ OPEN TO ALL STAFF ════════════════════════════════════════════════════

    // ─── CLAIM ────────────────────────────────────────────────────────────────
    if (action === "claim") {
        const phone = payload;

        // Fast-path: if the local claimStore already knows someone else holds
        // this phone, skip the round-trip to the API entirely — the answer
        // is already known. Owner bypasses this — they're allowed to attempt a takeover.
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

            // Read the row for the operator colour and the username (shown ONLY
            // in this private confirmation, never in the public channel embed).
            // The claim already SUCCEEDED server-side, so if this read fails we
            // carry on without it rather than report a false failure.
            let row = null;
            try { row = await getRequestByPhone(phone); }
            catch (e) { console.warn("⚠️  Could not load the request row after claiming (continuing without it):", e.message); }

            const claimedContent = row?.username
                ? `${t(lang, "claimed", formatPhone(phone), `<@${interaction.user.id}>`)}\n${t(lang, "claimed_username", row.username)}`
                : t(lang, "claimed", formatPhone(phone), `<@${interaction.user.id}>`);
            await safeReply(interaction, deferred, { content: claimedContent });

            const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setTitle("📋 Request In Progress")
                .setDescription(
                    `👤 Claimed by <@${interaction.user.id}>\n` +
                    `⏰ Claimed <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
                    `**🔧 Choose an action:**`
                );
            if (row) newEmbed.setColor(getOperatorColor(row.operator));

            await safeEditMessage(interaction.client, interaction.message, {
                content:    pingUser(interaction.user.id),
                embeds:     [newEmbed],
                components: [buildPostClaimRow(phone)],
            });
            broadcastRequestUpdate(row || { phone }, { status: "processing", claimedByDiscordId: interaction.user.id });
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

    // ══ CLAIMER-ONLY BUTTONS ═══════════════════════════════════════════════════
    // Defer FIRST (in-memory, no network besides the ack itself) — THEN do the
    // permission check. OWNER bypasses this lock entirely.
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
            if (!data.success) { await safeReply(interaction, deferred, { content: "❌ " + tApi(lang, data.message) }); return; }
            await safeReply(interaction, deferred, { content: t(lang, "len_requested", 4, formatPhone(phone)) });
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x10b981).setTitle("⏳ Awaiting Code (4 digits)")
                .setDescription(
                    `👤 Claimed by <@${interaction.user.id}>\n` +
                    `🔢 Requested code: \`4 digits\`\n` +
                    `⏰ <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
                    `*Waiting for the user to enter it…*`
                );
            await safeEditMessage(interaction.client, interaction.message, { content: pingUser(interaction.user.id), embeds: [doneEmbed], components: [] });
            broadcastRequestUpdate({ phone }, { status: "waiting_code", codeLength: 4, claimedByDiscordId: interaction.user.id });
        } catch (e) { console.error("len4 error:", e); await safeReply(interaction, deferred, { content: t(lang, "generic_error") }); }
        return;
    }

    // ─── 6 CHIFFRES ───────────────────────────────────────────────────────────
    if (action === "len6") {
        try {
            const data = await callStaffAction("set_length", phone, interaction.user.tag, 6);
            if (!data.success) { await safeReply(interaction, deferred, { content: "❌ " + tApi(lang, data.message) }); return; }
            await safeReply(interaction, deferred, { content: t(lang, "len_requested", 6, formatPhone(phone)) });
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x10b981).setTitle("⏳ Awaiting Code (6 digits)")
                .setDescription(
                    `👤 Claimed by <@${interaction.user.id}>\n` +
                    `🔢 Requested code: \`6 digits\`\n` +
                    `⏰ <t:${Math.floor(Date.now() / 1000)}:R>\n\n` +
                    `*Waiting for the user to enter it…*`
                );
            await safeEditMessage(interaction.client, interaction.message, { content: pingUser(interaction.user.id), embeds: [doneEmbed], components: [] });
            broadcastRequestUpdate({ phone }, { status: "waiting_code", codeLength: 6, claimedByDiscordId: interaction.user.id });
        } catch (e) { console.error("len6 error:", e); await safeReply(interaction, deferred, { content: t(lang, "generic_error") }); }
        return;
    }

    // ─── MAUVAIS NUMÉRO ───────────────────────────────────────────────────────
    if (action === "wrong") {
        try {
            const data = await callStaffAction("wrong_number", phone, interaction.user.tag);
            if (!data.success) { await safeReply(interaction, deferred, { content: "❌ " + tApi(lang, data.message) }); return; }
            await safeReply(interaction, deferred, { content: t(lang, "wrong_reported", formatPhone(phone)) });
            const reporter = interaction.user.id;
            clearClaimer(phone);
            forgetMessage(phone); // terminal state — no more refreshes needed for this request
            const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xef4444).setTitle("❌ Wrong Number")
                .setDescription(`❌ The user is being redirected to re-enter their number.\n⏰ <t:${Math.floor(Date.now() / 1000)}:R>`);
            await safeEditMessage(interaction.client, interaction.message, { content: pingUser(reporter), embeds: [doneEmbed], components: [] });
            broadcastRequestRemoved(phone);
        } catch (e) { console.error("wrong error:", e); await safeReply(interaction, deferred, { content: t(lang, "generic_error") }); }
        return;
    }

    // ─── UNCLAIM ──────────────────────────────────────────────────────────────
    if (action === "unclaim") {
        try {
            const data = await callStaffAction("unclaim", phone, interaction.user.tag);
            if (!data.success) { await safeReply(interaction, deferred, { content: "❌ " + tApi(lang, data.message) }); return; }
            clearClaimer(phone);
            await safeReply(interaction, deferred, { content: t(lang, "unclaimed", formatPhone(phone)) });

            const reclaimRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId("claim_" + phone).setLabel("📋 Claim").setStyle(ButtonStyle.Primary)
            );

            const unclaimedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x6b7280).setTitle("📭 Request Unclaimed")
                .setDescription(`↩️ Unclaimed by <@${interaction.user.id}>\n⏰ <t:${Math.floor(Date.now() / 1000)}:R>\nBack in the waiting queue.`);
            // Back in the pool for anyone to grab — ping @access again, like a new request.
            await safeEditMessage(interaction.client, interaction.message, {
                content:    pingAccessRole(),
                embeds:     [unclaimedEmbed],
                components: [reclaimRow],
            });
            broadcastRequestUpdate({ phone }, { status: "pending", claimedByDiscordId: null, codeLength: null, staffCode: null });
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
            if (!data.success) { await safeReply(interaction, deferred, { content: "❌ " + tApi(lang, data.message) }); return; }
            await safeReply(interaction, deferred, { content: t(lang, "truecode_ok", formatPhone(phone)) });
            const validator = interaction.user.id;
            clearClaimer(phone);

            // The DM belongs to this one person — safe to translate.
            const dmEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0x10b981).setTitle(t(lang, "dm_truecode_title"))
                .setDescription(t(lang, "dm_truecode_desc", Math.floor(Date.now() / 1000)));
            await safeEditMessage(interaction.client, interaction.message, { embeds: [dmEmbed], components: [] });

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
            broadcastRequestRemoved(phone);
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
            if (!data.success) { await safeReply(interaction, deferred, { content: "❌ " + tApi(lang, data.message) }); return; }

            await safeReply(interaction, deferred, { content: t(lang, "falsecode_ok", formatPhone(phone)) });

            // The DM belongs to this one person — safe to translate.
            const dmEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                .setColor(0xf59e0b).setTitle(t(lang, "dm_falsecode_title"))
                .setDescription(t(lang, "dm_falsecode_desc"));
            await safeEditMessage(interaction.client, interaction.message, { embeds: [dmEmbed], components: [] });

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
                    components: [buildPostClaimRow(phone)],
                })
            );
            broadcastRequestUpdate({ phone }, { status: "retry_code", claimedByDiscordId: interaction.user.id, staffCode: null, codeLength: null });
        } catch (e) { console.error("falsecode error:", e); await safeReply(interaction, deferred, { content: t(lang, "generic_error") }); }
        return;
    }

    console.warn("⚠️  Unknown button action:", action, "payload:", payload);
    // Don't leave the deferred reply hanging on "thinking…".
    await safeReply(interaction, deferred, { content: t(lang, "generic_error") });
}
