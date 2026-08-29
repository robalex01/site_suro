import "dotenv/config";

export const CONFIG = {
    TOKEN:          process.env.DISCORD_BOT_TOKEN,
    CLIENT_ID:      process.env.DISCORD_CLIENT_ID,
    GUILD_ID:       process.env.DISCORD_GUILD_ID       || null,
    LOG_CHANNEL_ID: process.env.DISCORD_LOG_CHANNEL_ID || null,
    DATABASE_URL:   process.env.DATABASE_URL,
    STAFF_SECRET:   process.env.STAFF_SECRET,
    API_BASE:       (process.env.API_BASE || "https://snaptech.vercel.app").replace(/\/$/, ""),
};

export function validateConfig() {
    // Hard required — bot cannot start without these
    const required = ["TOKEN", "CLIENT_ID", "DATABASE_URL", "STAFF_SECRET"];
    const missing = required.filter(k => !CONFIG[k]);
    if (missing.length > 0) {
        console.error("❌ Missing required env variables:", missing.join(", "));
        process.exit(1);
    }

    // Soft required — bot starts but features are degraded
    if (!CONFIG.LOG_CHANNEL_ID) {
        console.warn("⚠️  DISCORD_LOG_CHANNEL_ID not set — run /config in Discord to set it");
    }
    if (!CONFIG.GUILD_ID) {
        console.warn("⚠️  DISCORD_GUILD_ID not set — slash commands will deploy globally (up to 1h delay)");
    }

    console.log("✅ Config loaded");
    console.log("   API_BASE    :", CONFIG.API_BASE);
    console.log("   Log channel :", CONFIG.LOG_CHANNEL_ID || "(not set)");
    console.log("   Guild ID    :", CONFIG.GUILD_ID       || "(global)");
}
