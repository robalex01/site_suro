import "dotenv/config";

/**
 * Turns a sloppily-written ping into a real Discord mention.
 *   "@&123"  -> "<@&123>"   (angle brackets forgotten)
 *   "123"    -> "<@&123>"   (bare role ID pasted in)
 *   "<@&123>", "@here", "@everyone" -> unchanged (already valid)
 * Empty/unset -> null (no ping at all, the default).
 */
function normalisePingMessage(raw) {
    const value = (raw || "").trim();
    if (!value) return null;
    if (/^@&\d+$/.test(value))  return `<@&${value.slice(2)}>`;
    if (/^\d{15,25}$/.test(value)) return `<@&${value}>`;
    return value;
}

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
    //
    // Normalised on the way in: a role ID written without its angle brackets
    // ("@&123", or a bare "123456789") is NOT a Discord mention — it renders
    // as literal text and pings nobody, which looks identical in the config
    // log to a working one. Repairing it here turns a silent no-ping into a
    // working ping instead of a bug nobody notices for weeks.
    PING_MESSAGE:   normalisePingMessage(process.env.DISCORD_PING_MESSAGE),

    // Role pinged on brand-new requests (before anyone claims them).
    ACCESS_ROLE_ID: process.env.ACCESS_ROLE_ID || "1546160211054559334",

    // ─── Permissions ────────────────────────────────────────────────────
    // OWNER: full access to everything — every command, every button on
    // every request regardless of who claimed it. Bypasses the
    // claimer-only lock entirely.
    OWNER_ROLE_ID: process.env.OWNER_ROLE_ID || "1545903998442405970",
    // STAFF: required to run any slash command or click any request
    // button at all. Defaults to the same role as ACCESS_ROLE_ID (the
    // role already pinged on new requests) since that's who's meant to
    // be working requests, but kept as a separate setting in case they
    // ever diverge.
    STAFF_ROLE_ID: process.env.STAFF_ROLE_ID || "1546160211054559334",

    // Channel where the personal staff-settings panel (language, ping
    // preference, etc.) is posted. Each staff member configures only
    // their own preferences there — never the bot's global config.
    STAFF_CONFIG_CHANNEL_ID: process.env.STAFF_CONFIG_CHANNEL_ID || "1550994704018046976",

    // Per-operator channel routing — falls back to LOG_CHANNEL_ID if unset.
    // "belgium" groups BASE, Orange Belgium, Proximus and Telenet into one channel.
    CHANNELS: {
        orange:   process.env.CHANNEL_ORANGE_ID   || null,
        sfr:      process.env.CHANNEL_SFR_ID      || null,
        bouygues: process.env.CHANNEL_BOUYGUES_ID || null,
        belgium:  process.env.CHANNEL_BELGIUM_ID  || null,
    },
    // Hour (0-23, server/UTC time) at which the optional personal "daily
    // summary" DM is sent to staff who opted in. No per-user timezone is
    // tracked, so this is one shared hour for everyone — default 20 (8 PM UTC).
    DAILY_SUMMARY_HOUR_UTC: Number.isFinite(parseInt(process.env.DAILY_SUMMARY_HOUR_UTC, 10))
        ? parseInt(process.env.DAILY_SUMMARY_HOUR_UTC, 10)
        : 20,
};

// Belgian carriers all route to the single "belgium" channel.
const BELGIAN_OPERATORS = ["base", "orange_be", "proximus", "telenet"];

// The set of "operator groups" the bot actually distinguishes anywhere
// (channel routing, per-staff DM-alert filtering). Deliberately the same
// four buckets as CHANNELS above, plus "other" for anything unrecognised —
// there is no finer-grained grouping anywhere else in the bot, so exposing
// more detail in a filter UI would offer choices that don't correspond to
// any real distinction the bot makes.
export const OPERATOR_GROUPS = ["orange", "sfr", "bouygues", "belgium", "other"];

/** Which group a raw carrier code (row.operator) belongs to. */
export function getOperatorGroup(operator) {
    const op = operator?.toLowerCase();
    if (BELGIAN_OPERATORS.includes(op)) return "belgium";
    if (op === "orange" || op === "sfr" || op === "bouygues") return op;
    return "other";
}

/**
 * Resolve which Discord channel ID a given carrier should post to.
 * Falls back to CONFIG.LOG_CHANNEL_ID if no dedicated channel is configured.
 */
export function getChannelIdForOperator(operator) {
    const group = getOperatorGroup(operator);
    if (group === "other") return CONFIG.LOG_CHANNEL_ID;
    return CONFIG.CHANNELS[group] || CONFIG.LOG_CHANNEL_ID;
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
    console.log("   Owner role     :", CONFIG.OWNER_ROLE_ID);
    console.log("   Acces role     :", CONFIG.STAFF_ROLE_ID);
    console.log("   Acces cfg chan.:", CONFIG.STAFF_CONFIG_CHANNEL_ID || "(not set)");
}
