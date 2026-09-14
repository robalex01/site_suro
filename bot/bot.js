import "dotenv/config";
import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { CONFIG, validateConfig } from "./src/config.js";
import { slashCommands } from "./src/commands.js";
import { startPolling } from "./src/polling.js";
import { handleButton } from "./src/handlers/buttons.js";
import { handleSlash } from "./src/handlers/slash.js";

validateConfig();

// ─── Process-level safety net ──────────────────────────────────────────────
// Under heavy load (many concurrent requests/interactions), a single
// unexpected rejection anywhere that isn't explicitly caught can otherwise
// bring the whole Node process down silently (no crash log, systemd/Docker
// just sees it exit and restart, dropping whatever was in flight). Logging
// instead of crashing keeps the bot serving everyone else while the one bad
// interaction gets investigated from the logs.
process.on("unhandledRejection", (reason) => {
    console.error("❌ Unhandled promise rejection:", reason);
});
process.on("uncaughtException", (err) => {
    console.error("❌ Uncaught exception:", err);
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

const rest = new REST({ version: "10" }).setToken(CONFIG.TOKEN);

/**
 * Deploy slash commands.
 *
 * FIX — Duplicate commands:
 *   Old: deployed to guild but never cleared global → both sets showed in Discord.
 *   New: if GUILD_ID is set, deploy to guild AND wipe global commands.
 *        If no GUILD_ID, deploy globally and wipe guild commands for this app.
 */
async function deployCommands() {
    try {
        console.log("🔄 Deploying slash commands...");

        if (CONFIG.GUILD_ID) {
            // 1. Deploy to guild (instant)
            await rest.put(
                Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID),
                { body: slashCommands.map(c => c.toJSON()) }
            );
            // 2. Wipe global commands so they don't appear as duplicates
            await rest.put(
                Routes.applicationCommands(CONFIG.CLIENT_ID),
                { body: [] }
            );
            console.log("✅ Commands deployed to guild — global commands cleared");
        } else {
            // Deploy globally (up to 1 h propagation)
            await rest.put(
                Routes.applicationCommands(CONFIG.CLIENT_ID),
                { body: slashCommands.map(c => c.toJSON()) }
            );
            console.log("✅ Commands deployed globally");
        }
    } catch (e) {
        console.error("❌ Slash command deploy error:", e.message || e);
    }
}

client.once("ready", () => {
    console.log("🤖 Bot connected as " + client.user.tag);
    console.log("📡 API: " + CONFIG.API_BASE);
    console.log("📝 Log channel: " + (CONFIG.LOG_CHANNEL_ID || "Not set — use /config"));
    deployCommands().catch(e => console.error("Deploy error:", e));
    startPolling(client);
});

client.on("interactionCreate", async interaction => {
    try {
        if (interaction.isButton())          await handleButton(interaction);
        if (interaction.isChatInputCommand()) await handleSlash(interaction);
    } catch (e) {
        console.error("Interaction error:", e);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "❌ An error occurred", flags: 64 }).catch(() => {});
        }
    }
});

client.login(CONFIG.TOKEN);
