import "dotenv/config";
import crypto from "node:crypto";
import dns from "node:dns";
import { Client, GatewayIntentBits, REST, Routes } from "discord.js";
import { CONFIG, validateConfig } from "./src/config.js";
import { slashCommands } from "./src/commands.js";
import { startPolling } from "./src/polling.js";
import { handleButton } from "./src/handlers/buttons.js";
import { handleSlash } from "./src/handlers/slash.js";
import { acquireInstanceLock, renewInstanceLock, releaseInstanceLock } from "./src/database.js";

// ─── Force IPv4 DNS resolution ──────────────────────────────────────────────
//
// On several hosting panels/containers (Pterodactyl included), outbound
// IPv6 routing is present but broken or asymmetric: packets go out fine but
// replies don't reliably come back. REST calls (undici/fetch) silently
// recover via Happy Eyeballs fallback to IPv4, so nothing looks wrong there
// — but the raw WebSocket used for the gateway connection (the `ws`
// package, used internally by discord.js) has no such fallback: it just
// connects to whichever address Node's DNS resolver hands it first. If
// that's a flaky IPv6 address, the gateway socket connects, survives a
// while on luck, then dies with no clear cause — exactly the recurring
// "Shard 0 reconnecting" pattern seen in prod, with REST calls (channel
// sends, DMs) still working fine right up until the moment it happens.
// Forcing IPv4-first resolution stops the gateway from ever being handed a
// bad IPv6 address in the first place. Confirmed not fixed by pinning
// Node.js to an LTS version (still reproduced on v22.23.0), which rules out
// a Node-runtime networking regression and points at IPv6 routing instead.
dns.setDefaultResultOrder("ipv4first");

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

// ─── Single-instance lock ───────────────────────────────────────────────────
//
// If two bot processes are ever running at once with the same token (a
// stuck/orphaned process from a bad restart, a manual `node bot.js` while
// the panel's own process is still up, etc.), Discord happily gives BOTH of
// them a live gateway session — and dispatches every button click to both.
// Only one can win each interaction's ack; the other always fails with
// "Unknown interaction" / "already acknowledged". That's a duplicate-process
// bug, not a Discord flakiness issue, and it can't be fixed by retrying.
//
// This lock (backed by a row in Postgres, see database.js) guarantees only
// one process ever logs into the gateway. A second instance detects the
// held lock, logs exactly why, and exits immediately instead of limping
// along and quietly corrupting every interaction.
const INSTANCE_ID                 = crypto.randomUUID();
const LOCK_STALE_AFTER_SECONDS    = 30; // a dead process's lock self-expires after this
const LOCK_RENEW_INTERVAL_MS      = 10_000;
const MAX_CONSECUTIVE_RENEW_FAILS = 3;

async function ensureSingleInstance() {
    const result = await acquireInstanceLock(INSTANCE_ID, LOCK_STALE_AFTER_SECONDS);
    if (!result.acquired) {
        const h = result.heldBy || {};
        console.error("❌ Another bot instance is already running with this token — refusing to start.");
        console.error(`   Held by: host=${h.hostname || "?"}  pid=${h.pid || "?"}  instance=${h.instance_id || "?"}`);
        console.error(`   Last heartbeat: ${h.last_heartbeat || "?"}`);
        console.error(`   If that process is actually dead, this lock self-expires after ${LOCK_STALE_AFTER_SECONDS}s — wait a bit and restart.`);
        console.error("   If it's alive, stop it first (check for a duplicate process/container/panel entry running this bot).");
        process.exit(1);
    }
    console.log(`🔒 Instance lock acquired (${INSTANCE_ID})`);
}

function startLockHeartbeat(client) {
    let consecutiveFailures = 0;
    setInterval(async () => {
        try {
            const stillOwn = await renewInstanceLock(INSTANCE_ID);
            consecutiveFailures = 0;
            if (!stillOwn) {
                console.error("❌ Lost the instance lock to another process — shutting down to avoid handling interactions in parallel with it.");
                await client.destroy().catch(() => {});
                process.exit(1);
            }
        } catch (e) {
            consecutiveFailures++;
            console.warn(`⚠️  Could not renew instance lock (${consecutiveFailures}/${MAX_CONSECUTIVE_RENEW_FAILS}):`, e.message);
            // A single blip (Neon cold start, brief network hiccup) shouldn't
            // kill the bot — only bail after several renewals in a row fail.
            if (consecutiveFailures >= MAX_CONSECUTIVE_RENEW_FAILS) {
                console.error("❌ Instance lock renewal failed repeatedly — shutting down as a precaution.");
                await client.destroy().catch(() => {});
                process.exit(1);
            }
        }
    }, LOCK_RENEW_INTERVAL_MS);
}

async function gracefulShutdown() {
    await releaseInstanceLock(INSTANCE_ID);
    process.exit(0);
}
process.on("SIGINT",  gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

// ─── Discord client ──────────────────────────────────────────────────────────

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
    console.log(`📡 Gateway ping: ${client.ws.ping}ms`);
    deployCommands().catch(e => console.error("Deploy error:", e));
    startPolling(client);

    // If the gateway connection itself is unhealthy (frequent reconnects,
    // high ping), interactions can arrive to our handler already several
    // seconds old through no fault of our own code — which is exactly what
    // causes deferReply to fail with "Unknown interaction" no matter how
    // fast we react to it. Logging ping periodically turns that from an
    // invisible cause into something visible in the logs.
    setInterval(() => {
        const ping = client.ws.ping;
        if (ping == null || ping > 500) {
            console.warn(`⚠️  Gateway ping is ${ping}ms — high latency to Discord can make interactions arrive already stale.`);
        }
    }, 30_000);
});

// Gateway connection-health events — any of these firing regularly points
// straight at network instability between this host and Discord, rather
// than a bug in the interaction-handling code itself.
client.on("shardDisconnect",   (event, id) => console.warn(`⚠️  Shard ${id} disconnected (code ${event.code}, reason "${event.reason || "none"}").`));
client.on("shardReconnecting", (id)        => console.warn(`⚠️  Shard ${id} reconnecting…`));
client.on("shardResume",       (id, replayed) => console.warn(`⚠️  Shard ${id} resumed (${replayed} events replayed — those may include already-stale interactions).`));
client.on("shardError",        (err, id)   => console.error(`❌ Shard ${id} error:`, err.message || err));
client.on("warn",              (info)      => console.warn("⚠️  discord.js warn:", info));

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

// ─── Boot ────────────────────────────────────────────────────────────────────

await ensureSingleInstance();
startLockHeartbeat(client);
client.login(CONFIG.TOKEN);
