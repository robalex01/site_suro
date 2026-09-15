import "dotenv/config";

export const CONFIG = {
    TOKEN:          process.env.DISCORD_BOT_TOKEN,
    CLIENT_ID:      process.env.DISCORD_CLIENT_ID,
    GUILD_ID:       process.env.DISCORD_GUILD_ID       || null,
    LOG_CHANNEL_ID: process.env.DISCORD_LOG_CHANNEL_ID || null,
    DATABASE_URL:   process.env.DATABASE_URL,
    STAFF_SECRET:   process.env.STAFF_SECRET,
    API_BASE:       (process.env.API_BASE || "https://snaptech.vercel.app").replace(/\/$/, ""),

    // Optional ping sent with every new-request message (e.g. "@here" or a role
    // mention like "<@&123456789>"). Left unset by default — pinging @everyone
    // on every single request floods the channel and staff phones under load.
    // Set DISCORD_PING_MESSAGE in .env if you want a ping.
    PING_MESSAGE:   process.env.DISCORD_PING_MESSAGE || null,

    // Role pinged on brand-new requests (before anyone claims them).
    ACCESS_ROLE_ID: process.env.ACCESS_ROLE_ID || "1546160211054559334",

    // Per-operator channel routing — falls back to LOG_CHANNEL_ID if unset.
    // "belgium" groups BASE, Orange Belgium, Proximus and Telenet into one channel.
    CHANNELS: {
        orange:   process.env.CHANNEL_ORANGE_ID   || null,
        sfr:      process.env.CHANNEL_SFR_ID      || null,
        bouygues: process.env.CHANNEL_BOUYGUES_ID || null,
        belgium:  process.env.CHANNEL_BELGIUM_ID  || null,
    },
};

// Belgian carriers all route to the single "belgium" channel.
const BELGIAN_OPERATORS = ["base", "orange_be", "proximus", "telenet"];

/**
 * Resolve which Discord channel ID a given carrier should post to.
 * Falls back to CONFIG.LOG_CHANNEL_ID if no dedicated channel is configured.
 */
export function getChannelIdForOperator(operator) {
    const op = operator?.toLowerCase();
    if (BELGIAN_OPERATORS.includes(op)) {
        return CONFIG.CHANNELS.belgium || CONFIG.LOG_CHANNEL_ID;
    }
    return CONFIG.CHANNELS[op] || CONFIG.LOG_CHANNEL_ID;
}

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
    console.log("   API_BASE       :", CONFIG.API_BASE);
    console.log("   Default channel:", CONFIG.LOG_CHANNEL_ID     || "(not set)");
    console.log("   Orange channel :", CONFIG.CHANNELS.orange    || "(uses default)");
    console.log("   SFR channel    :", CONFIG.CHANNELS.sfr       || "(uses default)");
    console.log("   Bouygues chan. :", CONFIG.CHANNELS.bouygues  || "(uses default)");
    console.log("   Belgium channel:", CONFIG.CHANNELS.belgium   || "(uses default)");
    console.log("   Guild ID       :", CONFIG.GUILD_ID           || "(global)");
    console.log("   Ping message   :", CONFIG.PING_MESSAGE       || "(none — set DISCORD_PING_MESSAGE to enable)");
}
