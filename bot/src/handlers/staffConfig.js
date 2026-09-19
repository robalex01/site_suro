/**
 * staffConfig.js — personal staff settings panel
 *
 * Posts ONE persistent embed in CONFIG.STAFF_CONFIG_CHANNEL_ID with a single
 * "⚙️ My Settings" button. Clicking it opens an EPHEMERAL message (visible
 * only to the clicker) with their own language + ping-notification controls.
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
 *    language changes what YOU receive; the bot's behaviour for everyone
 *    else is untouched.
 *
 * The public panel is the one thing that can't be personalised (see above),
 * so it's written in all four supported languages rather than picking one.
 */

import {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder,
} from "discord.js";
import { CONFIG } from "../config.js";
import {
    getStaticMessage, setStaticMessage,
    getStaffPrefs, upsertStaffPrefs, resetStaffPrefs,
} from "../database.js";
import { isStaff } from "../utils/permissions.js";
import { t } from "../utils/i18n.js";
import { getPrefs, primePrefs } from "../utils/userPrefs.js";
import { invalidatePingCache } from "../utils/pings.js";

const PANEL_MESSAGE_NAME = "staff_config_panel";

const LANGUAGES = [
    { value: "en", label: "English",   emoji: "🇬🇧" },
    { value: "fr", label: "Français",  emoji: "🇫🇷" },
    { value: "pl", label: "Polski",    emoji: "🇵🇱" },
    { value: "es", label: "Español",   emoji: "🇪🇸" },
];

function languageLabel(code) {
    const l = LANGUAGES.find(x => x.value === code);
    return l ? `${l.emoji} ${l.label}` : code;
}

// ─── Public panel (posted once, edited in place on every restart) ─────────────

function buildPublicPanelEmbed() {
    return new EmbedBuilder()
        .setTitle("⚙️ Staff Settings  ·  Réglages  ·  Ustawienia  ·  Ajustes")
        .setColor(0x3b82f6)
        .setDescription(
            "🇬🇧 Set **your own** language and whether you get pinged. Personal only — nothing global changes.\n" +
            "🇫🇷 Choisis **ta** langue et si tu reçois les pings. Réglages personnels — rien de global ne change.\n" +
            "🇵🇱 Ustaw **swój** język i to, czy dostajesz pingi. Tylko osobiste — nic globalnego się nie zmienia.\n" +
            "🇪🇸 Elige **tu** idioma y si recibes menciones. Solo personal — nada global cambia."
        )
        .addFields({
            name: "🌐 Available / Disponibles",
            value: LANGUAGES.map(l => `${l.emoji} ${l.label}`).join("  ·  "),
        })
        .setFooter({ text: "⚙️ Snaptech Staff Settings  •  Default: English, pings ON" });
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
                name:   t(lang, "settings_pings_label"),
                value:  prefs.receive_pings ? t(lang, "settings_pings_enabled") : t(lang, "settings_pings_disabled"),
                inline: true,
            },
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

    const actionRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("cfgping")
            .setLabel(prefs.receive_pings ? t(lang, "settings_ping_disable_btn") : t(lang, "settings_ping_enable_btn"))
            .setStyle(prefs.receive_pings ? ButtonStyle.Danger : ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("cfgreset")
            .setLabel(t(lang, "settings_reset_btn"))
            .setStyle(ButtonStyle.Secondary),
    );

    return [langRow, actionRow];
}

/** Shared payload builder — the panel looks the same however it was reached. */
function panelPayload(prefs) {
    return {
        embeds:     [buildPersonalEmbed(prefs)],
        components: buildPersonalComponents(prefs),
    };
}

/** "⚙️ My Settings" button — opens the ephemeral personal panel. */
async function handleOpen(interaction) {
    const prefs = await getPrefs(interaction.user.id);
    await interaction.reply({ ...panelPayload(prefs), flags: 64 });
}

/** Language select menu inside the ephemeral personal panel. */
async function handleLanguageSelect(interaction) {
    const language = interaction.values[0];
    const prefs    = await upsertStaffPrefs(interaction.user.id, { language });
    // Write through the cache so the very next interaction is already in the
    // new language rather than waiting out the TTL.
    primePrefs(interaction.user.id, prefs);
    await interaction.update(panelPayload(prefs));
}

/** Ping-toggle button inside the ephemeral personal panel. */
async function handlePingToggle(interaction) {
    const current = await getPrefs(interaction.user.id);
    const prefs   = await upsertStaffPrefs(interaction.user.id, { receive_pings: !current.receive_pings });
    primePrefs(interaction.user.id, prefs);
    // Drop the opt-out list so the change applies to the next request that
    // comes in, instead of up to 30 seconds later.
    invalidatePingCache();
    await interaction.update(panelPayload(prefs));
}

/** Reset button — deletes the row, returning this user to English + pings on. */
async function handleReset(interaction) {
    const prefs = await resetStaffPrefs(interaction.user.id);
    primePrefs(interaction.user.id, prefs);
    invalidatePingCache();
    await interaction.update(panelPayload(prefs));
}

// ─── Entry points used by bot.js ───────────────────────────────────────────────

/** Routes `cfgopen` / `cfgping` / `cfgreset` button interactions. */
export async function handleConfigButton(interaction) {
    if (!isStaff(interaction.member)) {
        const lang = (await getPrefs(interaction.user.id)).language;
        await interaction.reply({ content: t(lang, "no_permission"), flags: 64 });
        return;
    }
    const action = interaction.customId.split("_")[0];
    try {
        if (action === "cfgopen")  await handleOpen(interaction);
        if (action === "cfgping")  await handlePingToggle(interaction);
        if (action === "cfgreset") await handleReset(interaction);
    } catch (e) {
        console.error("Staff config button error:", e);
        if (!interaction.replied && !interaction.deferred) {
            const lang = (await getPrefs(interaction.user.id).catch(() => ({ language: "en" }))).language;
            await interaction.reply({ content: t(lang, "generic_error"), flags: 64 }).catch(() => {});
        }
    }
}

/** Routes the `cfglang` select menu interaction. */
export async function handleConfigSelect(interaction) {
    if (!isStaff(interaction.member)) {
        const lang = (await getPrefs(interaction.user.id)).language;
        await interaction.reply({ content: t(lang, "no_permission"), flags: 64 });
        return;
    }
    try {
        if (interaction.customId === "cfglang") await handleLanguageSelect(interaction);
    } catch (e) {
        console.error("Staff config select error:", e);
        if (!interaction.replied && !interaction.deferred) {
            const lang = (await getPrefs(interaction.user.id).catch(() => ({ language: "en" }))).language;
            await interaction.reply({ content: t(lang, "generic_error"), flags: 64 }).catch(() => {});
        }
    }
}
