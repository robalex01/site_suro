/**
 * staffConfig.js — personal staff settings panel  (v2.0)
 *
 * Posts ONE persistent embed in CONFIG.STAFF_CONFIG_CHANNEL_ID with a single
 * "⚙️ My Settings" button. Clicking it opens an EPHEMERAL message (visible
 * only to the clicker) with their own personal controls:
 *   - Language
 *   - DM Alert on new requests (reuses the receive_pings column/toggle)
 *   - DM Alert operator filter (which carriers DM you)
 *   - Snooze (temporarily pause DM alerts)
 *   - Daily summary (opt-in end-of-day recap DM)
 *   - My active claims / My stats / My recent actions (read-only views)
 *   - Reset to defaults
 *
 * WHY THE TWO-STEP DESIGN (public button -> private panel)
 * Discord renders a given message identically for every viewer: there is no
 * such thing as one public message whose visible content differs per reader.
 * The only per-person surfaces Discord offers are ephemeral replies and DMs.
 * So "each staff member sees their own settings" has to be built as a shared
 * button that opens a private panel — which is exactly what this is.
 *
 * SCOPE — PERSONAL, NEVER GLOBAL
 *  - Storage is keyed by Discord user ID (staff_preferences table).
 *  - Every response here is ephemeral (flags: 64) — Discord itself guarantees
 *    only the clicking user can see it.
 *  - Nothing here writes to CONFIG or to another user's row. Changing your
 *    settings changes what YOU receive; the bot's behaviour for everyone
 *    else is untouched.
 *
 * The public panel is the one thing that can't be personalised (see above),
 * so it's written in all four supported languages rather than picking one.
 */

import {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder,
} from "discord.js";
import { CONFIG, OPERATOR_GROUPS } from "../config.js";
import {
    getStaticMessage, setStaticMessage,
    getStaffPrefs, upsertStaffPrefs, resetStaffPrefs,
    getActiveClaims, getPersonalStats, getRecentActions,
} from "../database.js";
import { isStaff } from "../utils/permissions.js";
import { t } from "../utils/i18n.js";
import { getPrefs, primePrefs, forgetPrefs, peekLang } from "../utils/userPrefs.js";
import { invalidatePingCache } from "../utils/pings.js";
import { formatPhone } from "../utils/formatters.js";

// ACKNOWLEDGE FIRST, THEN HIT THE DATABASE.
//
// Discord kills an interaction token 3 seconds after it is created. Loading
// this user's preferences is a network round-trip to Postgres, and when that
// is slow (or the DB is unreachable and the call sits there until it times
// out) doing it BEFORE replying burns the entire window — the reply then
// fails with 10062 "Unknown interaction" and the staff member just sees
// "This interaction failed", having changed nothing.
//
// So every handler below acknowledges immediately (deferReply for a fresh
// panel, deferUpdate when editing the panel in place), and only then reads
// or writes preferences. This mirrors the safeDefer pattern already used
// for the request buttons in buttons.js, and is the reason those survived
// the same outage that broke this panel.

const PANEL_MESSAGE_NAME = "staff_config_panel";

const LANGUAGES = [
    { value: "en", label: "English",   emoji: "🇬🇧" },
    { value: "fr", label: "Français",  emoji: "🇫🇷" },
    { value: "pl", label: "Polski",    emoji: "🇵🇱" },
    { value: "es", label: "Español",   emoji: "🇪🇸" },
    { value: "ar", label: "العربية",  emoji: "🇸🇦" },
];

// Hours to add for each snooze quick-option. "clear" is handled separately.
const SNOOZE_HOURS = { "1h": 1, "4h": 4, "8h": 8, "24h": 24 };

function languageLabel(code) {
    const l = LANGUAGES.find(x => x.value === code);
    return l ? `${l.emoji} ${l.label}` : code;
}

function isSnoozeActive(snoozeUntil) {
    return !!snoozeUntil && new Date(snoozeUntil).getTime() > Date.now();
}

function opFilterLabel(lang, dmAlertOperators) {
    const codes = (dmAlertOperators || "").split(",").map(s => s.trim()).filter(Boolean);
    if (codes.length === 0) return t(lang, "settings_opfilter_all");
    return codes.map(c => t(lang, `op_group_${c}`)).join(", ");
}

function snoozeLabel(lang, snoozeUntil) {
    if (!isSnoozeActive(snoozeUntil)) return t(lang, "settings_snooze_inactive");
    return t(lang, "settings_snooze_active", Math.floor(new Date(snoozeUntil).getTime() / 1000));
}

/** Translated label for a request status, for the "My active claims" view. */
function statusLabel(lang, status) {
    const key = {
        processing:     "stats_progress",
        waiting_code:   "stats_waiting",
        code_submitted: "stats_submitted",
        retry_code:     "stats_retry",
    }[status];
    return key ? t(lang, key) : status;
}

// ─── Public panel (posted once, edited in place on every restart) ─────────────

function buildPublicPanelEmbed() {
    return new EmbedBuilder()
        .setTitle("⚙️ Access Settings  ·  Réglages  ·  Ustawienia  ·  Ajustes  ·  الإعدادات")
        .setColor(0x3b82f6)
        .setDescription(
            "🇬🇧 Set **your own** language, DM alerts and stats. Personal only — nothing global changes.\n" +
            "🇫🇷 Choisis **ta** langue, tes alertes MP et tes stats. Réglages personnels — rien de global ne change.\n" +
            "🇵🇱 Ustaw **swój** język, alerty DM i statystyki. Tylko osobiste — nic globalnego się nie zmienia.\n" +
            "🇪🇸 Elige **tu** idioma, tus alertas MP y tus estadísticas. Solo personal — nada global cambia.\n" +
            "🇸🇦 اختر **لغتك** وتنبيهاتك الخاصة وإحصائياتك. إعدادات شخصية فقط — لا شيء عام يتغيّر."
        )
        .addFields({
            name: "🌐 Available / Disponibles",
            value: LANGUAGES.map(l => `${l.emoji} ${l.label}`).join("  ·  "),
        })
        .setFooter({ text: "⚙️ Snaptech Staff Settings  •  Default: English, DM alerts ON" });
}

function buildOpenButtonRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("cfgopen").setLabel("⚙️ My Settings").setStyle(ButtonStyle.Secondary)
    );
}

/**
 * Posts the panel to CONFIG.STAFF_CONFIG_CHANNEL_ID, or edits the existing
 * one in place if it's already been posted (tracked in bot_static_messages)
 * — so a redeploy doesn't spam a fresh copy every time.
 */
export async function postOrUpdateConfigPanel(client) {
    if (!CONFIG.STAFF_CONFIG_CHANNEL_ID) return;

    let channel;
    try {
        channel = await client.channels.fetch(CONFIG.STAFF_CONFIG_CHANNEL_ID);
    } catch (e) {
        console.warn("⚠️  Could not fetch STAFF_CONFIG_CHANNEL_ID channel:", e.message);
        return;
    }
    if (!channel) return;

    const embed = buildPublicPanelEmbed();
    const row   = buildOpenButtonRow();

    const existing = await getStaticMessage(PANEL_MESSAGE_NAME);
    if (existing) {
        try {
            const msg = await channel.messages.fetch(existing.message_id);
            await msg.edit({ embeds: [embed], components: [row] });
            return;
        } catch (e) {
            console.warn("⚠️  Stored staff-settings panel message is gone, posting a new one:", e.message);
        }
    }

    try {
        const sent = await channel.send({ embeds: [embed], components: [row] });
        await setStaticMessage(PANEL_MESSAGE_NAME, channel.id, sent.id);
    } catch (e) {
        console.error("❌ Could not post staff-settings panel:", e.message || e);
    }
}

// ─── Personal panel (ephemeral, per-user) ──────────────────────────────────────

function buildPersonalEmbed(prefs) {
    const lang = prefs.language;
    return new EmbedBuilder()
        .setTitle(t(lang, "settings_title"))
        .setColor(0x3b82f6)
        .setDescription(t(lang, "settings_intro"))
        .addFields(
            { name: t(lang, "settings_language_label"), value: languageLabel(lang), inline: true },
            {
                name:   t(lang, "settings_dmalert_label"),
                value:  prefs.receive_pings ? t(lang, "settings_dmalert_enabled") : t(lang, "settings_dmalert_disabled"),
                inline: true,
            },
            {
                name:   t(lang, "settings_daily_label"),
                value:  prefs.daily_summary ? t(lang, "settings_daily_enabled") : t(lang, "settings_daily_disabled"),
                inline: true,
            },
            { name: t(lang, "settings_opfilter_label"), value: opFilterLabel(lang, prefs.dm_alert_operators), inline: true },
            { name: t(lang, "settings_snooze_label"),   value: snoozeLabel(lang, prefs.snooze_until),         inline: true },
            { name: "\u200b", value: t(lang, "settings_dmalert_note") },
            { name: "\u200b", value: t(lang, "settings_note_public") },
        )
        .setFooter({ text: t(lang, "settings_footer") });
}

function buildPersonalComponents(prefs) {
    const lang = prefs.language;

    const langRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("cfglang")
            .setPlaceholder(t(lang, "settings_lang_placeholder"))
            .addOptions(LANGUAGES.map(l => ({
                label: l.label,
                value: l.value,
                emoji: l.emoji,
                default: l.value === lang,
            })))
    );

    const currentOps = (prefs.dm_alert_operators || "").split(",").map(s => s.trim()).filter(Boolean);
    const opFilterRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("cfgopfilter")
            .setPlaceholder(t(lang, "settings_opfilter_placeholder"))
            .setMinValues(0)
            .setMaxValues(OPERATOR_GROUPS.length)
            .addOptions(OPERATOR_GROUPS.map(g => ({
                label:   t(lang, `op_group_${g}`),
                value:   g,
                default: currentOps.includes(g),
            })))
    );

    const snoozeOptions = [
        { label: t(lang, "snooze_opt_1h"),  value: "1h" },
        { label: t(lang, "snooze_opt_4h"),  value: "4h" },
        { label: t(lang, "snooze_opt_8h"),  value: "8h" },
        { label: t(lang, "snooze_opt_24h"), value: "24h" },
    ];
    if (isSnoozeActive(prefs.snooze_until)) {
        snoozeOptions.push({ label: t(lang, "snooze_opt_clear"), value: "clear" });
    }
    const snoozeRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("cfgsnooze")
            .setPlaceholder(t(lang, "settings_snooze_placeholder"))
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(snoozeOptions)
    );

    const toggleRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("cfgping")
            .setLabel(prefs.receive_pings ? t(lang, "settings_dmalert_disable_btn") : t(lang, "settings_dmalert_enable_btn"))
            .setStyle(prefs.receive_pings ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("cfgdaily")
            .setLabel(prefs.daily_summary ? t(lang, "settings_daily_disable_btn") : t(lang, "settings_daily_enable_btn"))
            .setStyle(prefs.daily_summary ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("cfgreset")
            .setLabel(t(lang, "settings_reset_btn"))
            .setStyle(ButtonStyle.Secondary),
    );

    const actionsRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("cfgclaims").setLabel(t(lang, "settings_btn_claims")).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("cfgstats").setLabel(t(lang, "settings_btn_stats")).setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("cfghistory").setLabel(t(lang, "settings_btn_history")).setStyle(ButtonStyle.Primary),
    );

    // 5 rows — Discord's per-message maximum. Any further control has to
    // replace one of these rather than add a 6th.
    return [langRow, opFilterRow, snoozeRow, toggleRow, actionsRow];
}

/** Shared payload builder — the panel looks the same however it was reached. */
function panelPayload(prefs) {
    return {
        embeds:     [buildPersonalEmbed(prefs)],
        components: buildPersonalComponents(prefs),
    };
}

function buildBackRow(lang) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("cfgback").setLabel(t(lang, "settings_back_btn")).setStyle(ButtonStyle.Secondary)
    );
}

// ─── Ack helpers (never throw) ────────────────────────────────────────────────

/** Acks without ever throwing. Returns false if the token was already dead. */
async function safeAck(interaction, mode) {
    try {
        if (mode === "reply") await interaction.deferReply({ flags: 64 });
        else                  await interaction.deferUpdate();
        return true;
    } catch (e) {
        const ageMs = Date.now() - interaction.createdTimestamp;
        console.warn(`⚠️  Could not ack settings interaction ${interaction.id} (${ageMs}ms old): ${e.message}`);
        return false;
    }
}

/** Edits the acked reply without ever throwing. */
async function safeEdit(interaction, payload) {
    try { await interaction.editReply(payload); }
    catch (e) { console.warn(`⚠️  Could not render settings panel for ${interaction.id}: ${e.message}`); }
}

/** "⚙️ My Settings" button — opens the ephemeral personal panel. */
async function handleOpen(interaction) {
    if (!await safeAck(interaction, "reply")) return;
    const prefs = await getPrefs(interaction.user.id);
    await safeEdit(interaction, panelPayload(prefs));
}

/** Language select menu inside the ephemeral personal panel. */
async function handleLanguageSelect(interaction) {
    if (!await safeAck(interaction, "update")) return;
    const language = interaction.values[0];
    const prefs    = await upsertStaffPrefs(interaction.user.id, { language });
    // Write through the cache so the very next interaction is already in the
    // new language rather than waiting out the TTL.
    primePrefs(interaction.user.id, prefs);
    await safeEdit(interaction, panelPayload(prefs));
}

/** DM-Alert toggle button (customId "cfgping" — reuses the receive_pings column). */
async function handlePingToggle(interaction) {
    if (!await safeAck(interaction, "update")) return;
    const current = await getPrefs(interaction.user.id);
    const prefs   = await upsertStaffPrefs(interaction.user.id, { receive_pings: !current.receive_pings });
    primePrefs(interaction.user.id, prefs);
    // No-op today (see pings.js) — kept so a future cache never needs this
    // call site updated.
    invalidatePingCache();
    await safeEdit(interaction, panelPayload(prefs));
}

/** Daily-summary toggle button. */
async function handleDailyToggle(interaction) {
    if (!await safeAck(interaction, "update")) return;
    const current = await getPrefs(interaction.user.id);
    const prefs   = await upsertStaffPrefs(interaction.user.id, { daily_summary: !current.daily_summary });
    primePrefs(interaction.user.id, prefs);
    await safeEdit(interaction, panelPayload(prefs));
}

/** DM-alert operator filter select menu — empty selection means "all operators". */
async function handleOpFilterSelect(interaction) {
    if (!await safeAck(interaction, "update")) return;
    const selected = interaction.values;
    const value    = selected.length > 0 ? selected.join(",") : null;
    const prefs    = await upsertStaffPrefs(interaction.user.id, { dm_alert_operators: value });
    primePrefs(interaction.user.id, prefs);
    await safeEdit(interaction, panelPayload(prefs));
}

/** Snooze select menu — pauses (or clears) the personal DM alert. */
async function handleSnoozeSelect(interaction) {
    if (!await safeAck(interaction, "update")) return;
    const choice = interaction.values[0];
    let snoozeUntil = null;
    if (choice !== "clear") {
        const hours = SNOOZE_HOURS[choice] || 0;
        snoozeUntil = new Date(Date.now() + hours * 3_600_000).toISOString();
    }
    const prefs = await upsertStaffPrefs(interaction.user.id, { snooze_until: snoozeUntil });
    primePrefs(interaction.user.id, prefs);
    await safeEdit(interaction, panelPayload(prefs));
}

/** Reset button — deletes the row, returning this user to English + defaults. */
async function handleReset(interaction) {
    if (!await safeAck(interaction, "update")) return;
    const prefs = await resetStaffPrefs(interaction.user.id);
    // The row is gone from Postgres — drop it from the in-memory copy too
    // (priming it with the defaults would make the DM alert treat this user
    // as still opted in, since defaults have receive_pings = true).
    forgetPrefs(interaction.user.id);
    invalidatePingCache();
    await safeEdit(interaction, panelPayload(prefs));
}

/** "My active claims" — read-only view, replaces the panel until "Back". */
async function handleShowClaims(interaction) {
    if (!await safeAck(interaction, "update")) return;
    const prefs = await getPrefs(interaction.user.id);
    const lang  = prefs.language;
    let rows = [];
    try { rows = await getActiveClaims(interaction.user.id); }
    catch (e) { console.warn("⚠️  Could not load active claims:", e.message); }

    const description = rows.length
        ? rows.map(r => t(
              lang, "claims_entry",
              formatPhone(r.phone),
              statusLabel(lang, r.status),
              Math.floor(new Date(r.updated_at).getTime() / 1000),
          )).join("\n")
        : t(lang, "claims_none");

    const embed = new EmbedBuilder()
        .setTitle(t(lang, "claims_title"))
        .setColor(0x3b82f6)
        .setDescription(description)
        .setFooter({ text: t(lang, "settings_footer") });

    await safeEdit(interaction, { embeds: [embed], components: [buildBackRow(lang)] });
}

/** "My stats" — read-only view, replaces the panel until "Back". */
async function handleShowStats(interaction) {
    if (!await safeAck(interaction, "update")) return;
    const prefs = await getPrefs(interaction.user.id);
    const lang  = prefs.language;

    let byAction = [], today = 0;
    try {
        ({ byAction, today } = await getPersonalStats(interaction.user.tag));
    } catch (e) {
        console.warn("⚠️  Could not load personal stats:", e.message);
    }
    const counts = {};
    byAction.forEach(r => { counts[r.action] = Number(r.count); });

    const embed = new EmbedBuilder()
        .setTitle(t(lang, "mystats_title"))
        .setColor(0x3b82f6)
        .setFooter({ text: t(lang, "settings_footer") });

    if (byAction.length === 0) {
        embed.setDescription(t(lang, "mystats_none"));
    } else {
        embed.addFields(
            { name: t(lang, "mystats_claims"),      value: "`" + (counts.claim || 0)      + "`", inline: true },
            { name: t(lang, "mystats_validations"), value: "`" + (counts.true_code || 0)  + "`", inline: true },
            { name: t(lang, "mystats_rejections"),  value: "`" + (counts.false_code || 0) + "`", inline: true },
            { name: t(lang, "mystats_today"),       value: "`" + today + "`",                    inline: true },
        );
    }

    await safeEdit(interaction, { embeds: [embed], components: [buildBackRow(lang)] });
}

/** "My recent actions" — last 10 logged actions, replaces the panel until "Back". */
async function handleShowHistory(interaction) {
    if (!await safeAck(interaction, "update")) return;
    const prefs = await getPrefs(interaction.user.id);
    const lang  = prefs.language;

    let rows = [];
    try { rows = await getRecentActions(interaction.user.tag, 10); }
    catch (e) { console.warn("⚠️  Could not load recent actions:", e.message); }

    const description = rows.length
        ? rows.map(r => {
              const label = t(lang, `hist_action_${r.action}`);
              const phone = r.details?.phone ? ` ${formatPhone(r.details.phone)}` : "";
              const ts    = Math.floor(new Date(r.created_at).getTime() / 1000);
              return `${label}${phone}  ·  <t:${ts}:R>`;
          }).join("\n")
        : t(lang, "history_none");

    const embed = new EmbedBuilder()
        .setTitle(t(lang, "history_title"))
        .setColor(0x3b82f6)
        .setDescription(description)
        .setFooter({ text: t(lang, "settings_footer") });

    await safeEdit(interaction, { embeds: [embed], components: [buildBackRow(lang)] });
}

/** "Back" button on the claims/stats/history views — returns to the main panel. */
async function handleBack(interaction) {
    if (!await safeAck(interaction, "update")) return;
    const prefs = await getPrefs(interaction.user.id);
    await safeEdit(interaction, panelPayload(prefs));
}

// ─── Entry points used by bot.js ───────────────────────────────────────────────

/** Routes every button customId owned by this panel. */
export async function handleConfigButton(interaction) {
    // peekLang, not getLang: nothing has acked yet, so this must not touch
    // the network. Cache hit gives their language, miss gives English.
    if (!isStaff(interaction.member)) {
        await interaction.reply({ content: t(peekLang(interaction.user.id), "no_permission"), flags: 64 }).catch(() => {});
        return;
    }
    const action = interaction.customId.split("_")[0];
    try {
        if (action === "cfgopen")    await handleOpen(interaction);
        if (action === "cfgping")    await handlePingToggle(interaction);
        if (action === "cfgdaily")   await handleDailyToggle(interaction);
        if (action === "cfgreset")   await handleReset(interaction);
        if (action === "cfgclaims")  await handleShowClaims(interaction);
        if (action === "cfgstats")   await handleShowStats(interaction);
        if (action === "cfghistory") await handleShowHistory(interaction);
        if (action === "cfgback")    await handleBack(interaction);
    } catch (e) {
        console.error("Staff config button error:", e.message || e);
        // Already acked by the handlers above, so this is an editReply, not
        // a fresh reply — and it's best-effort either way.
        await safeEdit(interaction, { content: t(peekLang(interaction.user.id), "generic_error"), embeds: [], components: [] });
    }
}

/** Routes every select-menu customId owned by this panel. */
export async function handleConfigSelect(interaction) {
    if (!isStaff(interaction.member)) {
        await interaction.reply({ content: t(peekLang(interaction.user.id), "no_permission"), flags: 64 }).catch(() => {});
        return;
    }
    try {
        if (interaction.customId === "cfglang")     await handleLanguageSelect(interaction);
        if (interaction.customId === "cfgopfilter") await handleOpFilterSelect(interaction);
        if (interaction.customId === "cfgsnooze")   await handleSnoozeSelect(interaction);
    } catch (e) {
        console.error("Staff config select error:", e.message || e);
        await safeEdit(interaction, { content: t(peekLang(interaction.user.id), "generic_error"), embeds: [], components: [] });
    }
}
