import "dotenv/config";
import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { CONFIG, validateConfig } from "./src/config.js";
import { slashCommands } from "./src/commands.js";
import { startPolling } from "./src/polling.js";
import { handleButton } from "./src/handlers/buttons.js";
import { handleSlash } from "./src/handlers/slash.js";

validateConfig();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const rest = new REST({ version: "10" }).setToken(CONFIG.TOKEN);

async function deployCommands() {
    try {
        console.log("🔄 Deploying slash commands...");
        const route = CONFIG.GUILD_ID 
            ? Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID) 
            : Routes.applicationCommands(CONFIG.CLIENT_ID);
        await rest.put(route, { body: slashCommands.map(c => c.toJSON()) });
        console.log("✅ Slash commands deployed");
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
        if (interaction.isButton()) await handleButton(interaction);
        if (interaction.isChatInputCommand()) await handleSlash(interaction);
    } catch (e) {
        console.error("Interaction error:", e);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: "❌ An error occurred", flags: 64 }).catch(() => {});
        }
    }
});

client.login(CONFIG.TOKEN);
