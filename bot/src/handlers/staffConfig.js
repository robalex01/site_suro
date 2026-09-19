/**
 * staffConfig.js — personal staff settings panel
 *
 * Posts ONE persistent embed in CONFIG.STAFF_CONFIG_CHANNEL_ID with a single
 * "⚙️ My Settings" button. Clicking it opens an EPHEMERAL message (visible
 * only to the clicker) with their own language + ping-notification controls.
 *
 * This is deliberately per-user, not global bot config:
 *  - Storage is keyed by Discord user ID (staff_preferences table).
 *  - Every response to a settings interaction is ephemeral (flags: 64) —
 *    Discord enforces that only the clicking user can ever see it.
 *  - Nothing here ever touches CONFIG or any other user's row.
 * So yes, it's fully possible for "each staff member to have their own view"
 * — that's exactly what ephemeral + per-user DB rows gives you. What is NOT
 * possible on Discord is a single public message whose *visible content*
 * differs per viewer — hence the two-step design (public open button ->
 * private personal panel) rather than one message everyone sees differently.
 */

import {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    StringSelectMenuBuilder,
} from "discord.js";
import { CONFIG } from "../config.js";
import { getStaticMessage, setStaticMessage, getStaffPrefs, upsertStaffPrefs } from "../database.js";
import { isStaff } from "../utils/permissions.js";

const PANEL_MESSAGE_NAME = "staff_config_panel";

const LANGUAGES = [
    { value: "fr", label: "Français",  emoji: "🇫🇷" },
    { value: "en", label: "English",   emoji: "🇬🇧" },
    { value: "pl", label: "Polski",    emoji: "🇵🇱" },
    { value: "es", label: "Español",   emoji: "🇪🇸" },
];

function languageLabel(code) {
    return LANGUAGES.find(l => l.value === code)?.label || code;
}

// ─── Public panel (posted once, edited in place on every restart) ─────────────

function buildPublicPanelEmbed() {
    return new EmbedBuilder()
        .setTitle("⚙️ Staff Settings")
        .setColor(0x3b82f6)
        .setDescription(
            "Configure your **own** experience with this bot — your display " +
            "language and whether you want to be pinged on new requests.\n\n" +
            "These are **personal** settings. Nothing here changes the bot's " +
            "global configuration or anyone else's settings — only your own."
        )
        .setFooter({ text: "⚙️ Snaptech Staff Settings" });
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
    return new EmbedBuilder()
        .setTitle("⚙️ My Settings")
        .setColor(0x3b82f6)
        .addFields(
            { name: "🌐 Language", value: `\`${languageLabel(prefs.language)}\``,                     inline: true },
            { name: "🔔 Pings",    value: prefs.receive_pings ? "`Enabled`" : "`Disabled`",              inline: true },
        )
        .setFooter({ text: "Only visible to you  •  Snaptech" });
}

function buildPersonalComponents(prefs) {
    const langRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId("cfglang")
            .setPlaceholder("Choose your language")
            .addOptions(LANGUAGES.map(l => ({
                label: l.label,
                value: l.value,
                emoji: l.emoji,
                default: l.value === prefs.language,
            })))
    );
    const pingRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("cfgping")
            .setLabel(prefs.receive_pings ? "🔕 Disable pings" : "🔔 Enable pings")
            .setStyle(prefs.receive_pings ? ButtonStyle.Danger : ButtonStyle.Success)
    );
    return [langRow, pingRow];
}

/** "⚙️ My Settings" button — opens the ephemeral personal panel. */
async function handleOpen(interaction) {
    const prefs = await getStaffPrefs(interaction.user.id);
    await interaction.reply({
        embeds: [buildPersonalEmbed(prefs)],
        components: buildPersonalComponents(prefs),
        flags: 64,
    });
}

/** Language select menu inside the ephemeral personal panel. */
async function handleLanguageSelect(interaction) {
    const language = interaction.values[0];
    const prefs    = await upsertStaffPrefs(interaction.user.id, { language });
    await interaction.update({
        embeds: [buildPersonalEmbed(prefs)],
        components: buildPersonalComponents(prefs),
    });
}

/** Ping-toggle button inside the ephemeral personal panel. */
async function handlePingToggle(interaction) {
    const current = await getStaffPrefs(interaction.user.id);
    const prefs   = await upsertStaffPrefs(interaction.user.id, { receive_pings: !current.receive_pings });
    await interaction.update({
        embeds: [buildPersonalEmbed(prefs)],
        components: buildPersonalComponents(prefs),
    });
}

// ─── Entry points used by bot.js ───────────────────────────────────────────────

/** Routes `cfgopen_*` / `cfgping_*` button interactions. */
export async function handleConfigButton(interaction) {
    if (!isStaff(interaction.member)) {
        await interaction.reply({ content: "❌ You don't have permission to use this.", flags: 64 });
        return;
    }
    const action = interaction.customId.split("_")[0];
    try {
        if (action === "cfgopen") await handleOpen(interaction);
        if (action === "cfgping") await handlePingToggle(interaction);
    } catch (e) {
        console.error("Staff config button error:", e);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "❌ An error occurred.", flags: 64 }).catch(() => {});
        }
    }
}

/** Routes the `cfglang` select menu interaction. */
export async function handleConfigSelect(interaction) {
    if (!isStaff(interaction.member)) {
        await interaction.reply({ content: "❌ You don't have permission to use this.", flags: 64 });
        return;
    }
    try {
        if (interaction.customId === "cfglang") await handleLanguageSelect(interaction);
    } catch (e) {
        console.error("Staff config select error:", e);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "❌ An error occurred.", flags: 64 }).catch(() => {});
        }
    }
}
