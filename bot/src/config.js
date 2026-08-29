import "dotenv/config";

export const CONFIG = {
    TOKEN: process.env.DISCORD_BOT_TOKEN,
    CLIENT_ID: process.env.DISCORD_CLIENT_ID,
    GUILD_ID: process.env.DISCORD_GUILD_ID,
    LOG_CHANNEL_ID: process.env.DISCORD_LOG_CHANNEL_ID,
    DATABASE_URL: process.env.DATABASE_URL,
    STAFF_SECRET: process.env.STAFF_SECRET,
    API_BASE: process.env.API_BASE || "https://snaptech.vercel.app"
};

export function validateConfig() {
    const required = ["TOKEN", "CLIENT_ID", "DATABASE_URL"];
    const missing = required.filter(k => !CONFIG[k]);
    if (missing.length > 0) {
        console.error("❌ Missing env variables:", missing.join(", "));
        process.exit(1);
    }
    console.log("✅ Config loaded");
}
