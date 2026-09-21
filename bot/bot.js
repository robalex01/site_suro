import "dotenv/config";
// Must come before anything that makes network calls: installs the
// keep-alive HTTP dispatcher (see src/net.js for why).
import "./src/net.js";
import crypto from "node:crypto";
import dns from "node:dns";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { Client, GatewayIntentBits, REST, Routes, Events } from "discord.js";
import { CONFIG, validateConfig } from "./src/config.js";
import { slashCommands } from "./src/commands.js";
import { startPolling } from "./src/polling.js";
import { handleButton } from "./src/handlers/buttons.js";
import { handleSlash } from "./src/handlers/slash.js";
import { postOrUpdateConfigPanel, handleConfigButton, handleConfigSelect } from "./src/handlers/staffConfig.js";
import { startDailySummarySchedule } from "./src/dailySummary.js";
import { acquireInstanceLock, renewInstanceLock, releaseInstanceLock } from "./src/database.js";
import { startPrefsRefresh, peekLang } from "./src/utils/userPrefs.js";
import { t } from "./src/utils/i18n.js";
import { startWebPanel } from "./src/web/server.js";

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

// ─── Event-loop lag monitor ──────────────────────────────────────────────────
//
// The console shows interactions arriving 2-45 SECONDS old ("gateway
// dispatch delay or blocked event loop"), gateway pings of 4-8 s, and REST
// calls timing out — but nothing in this bot does heavy synchronous work.
// This tells the two possible causes apart: if the event loop itself is
// stalling (max lag high while the bot is mostly idle), the host is CPU-
// throttled/starved and no code change will fix it — the container needs
// more CPU. If lag stays low while pings/defer latency are high, the
// bottleneck is the network path to Discord instead.
const loopDelay = monitorEventLoopDelay({ resolution: 20 });
loopDelay.enable();
setInterval(() => {
    const maxMs = Math.round(loopDelay.max / 1e6);
    const p99Ms = Math.round(loopDelay.percentile(99) / 1e6);
    if (maxMs > 1000) {
        console.warn(`🐌 Event loop stalled: max ${maxMs}ms, p99 ${p99Ms}ms over the last 30s — the host is CPU-starved/throttled (this is not a network problem).`);
    }
    loopDelay.reset();
}, 30_000);

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
//
// TIMING: the lock goes stale after 120s and we tolerate up to 9 failed
// renewals in a row (90s) before giving up. The failure budget MUST stay
// shorter than the stale window, otherwise a second instance could legally
// take the lock while we're still running on it. It used to be 30s stale /
// 3 fails x 10s = exactly 30s — no margin at all, and with the database
// flaking every few seconds (see the console) it kept sitting at "1/3" and
// "2/3", one bad minute away from killing a perfectly healthy bot. A restart
// costs minutes of downtime on this host (npm install runs on every start),
// so being patient here is much cheaper than exiting.
const INSTANCE_ID                 = crypto.randomUUID();
const LOCK_STALE_AFTER_SECONDS    = 120;
const LOCK_RENEW_INTERVAL_MS      = 10_000;
const MAX_CONSECUTIVE_RENEW_FAILS = 9;
const BOOT_LOCK_ATTEMPTS          = 6;

async function ensureSingleInstance() {
    let result;
    // A database hiccup at boot used to throw straight out of this top-level
    // await and crash the process — and every crash costs a full restart.
    for (let attempt = 1; ; attempt++) {
        try {
            result = await acquireInstanceLock(INSTANCE_ID, LOCK_STALE_AFTER_SECONDS);
            break;
        } catch (e) {
            if (attempt >= BOOT_LOCK_ATTEMPTS) {
                console.error(`❌ Could not reach the database to acquire the instance lock after ${BOOT_LOCK_ATTEMPTS} attempts:`, e.message);
                process.exit(1);
            }
            console.warn(`⚠️  Instance lock: database unreachable (attempt ${attempt}/${BOOT_LOCK_ATTEMPTS}): ${e.message} — retrying in 3s`);
            await new Promise(r => setTimeout(r, 3000));
        }
    }

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
    let renewing            = false; // never let two renewals run at once
    setInterval(async () => {
        if (renewing) return;
        renewing = true;
        try {
            const stillOwn = await renewInstanceLock(INSTANCE_ID);
            if (consecutiveFailures > 0) console.log(`✅ Instance lock renewal recovered after ${consecutiveFailures} failure${consecutiveFailures === 1 ? "" : "s"}.`);
            consecutiveFailures = 0;
            if (!stillOwn) {
                console.error("❌ Lost the instance lock to another process — shutting down to avoid handling interactions in parallel with it.");
                await client.destroy().catch(() => {});
                process.exit(1);
            }
        } catch (e) {
            consecutiveFailures++;
            console.warn(`⚠️  Could not renew instance lock (${consecutiveFailures}/${MAX_CONSECUTIVE_RENEW_FAILS}):`, e.message);
            if (consecutiveFailures >= MAX_CONSECUTIVE_RENEW_FAILS) {
                console.error("❌ Instance lock renewal failed repeatedly — shutting down as a precaution.");
                await client.destroy().catch(() => {});
                process.exit(1);
            }
        } finally {
            renewing = false;
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
    // Guilds only. This bot has no messageCreate handler and never reads
    // message text, so GuildMessages + MessageContent were pure overhead:
    // every single message sent anywhere in the server was being delivered
    // to (and processed by) this process over the gateway — real CPU and
    // bandwidth on a host that is already struggling — for nothing. Channel
    // sends, DMs, REST message fetches/edits and all interactions work
    // without them. (If a messageCreate feature is ever added, re-add
    // GuildMessages, plus MessageContent if the text itself is needed.)
    //
    // No GuildMembers intent either: the request-channel ping is a plain
    // @role mention (pings.js), which needs no member list.
    intents: [GatewayIntentBits.Guilds],
    // Fail hung REST calls after 10s (default 15s) — an interaction token is
    // dead after 3s anyway, and callers retry on their own.
    rest: { timeout: 10_000 },
});

const rest = new REST({ version: "10", timeout: 15_000 }).setToken(CONFIG.TOKEN);

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

// Events.ClientReady instead of the bare "ready" string: discord.js 14.2x
// renamed the event to "clientReady" and prints a DeprecationWarning for the
// old name (seen in the console). The constant resolves to the right name
// on every 14.x version.
client.once(Events.ClientReady, () => {
    console.log("🤖 Bot connected as " + client.user.tag);
    console.log("📡 API: " + CONFIG.API_BASE);
    console.log("📝 Log channel: " + (CONFIG.LOG_CHANNEL_ID || "Not set — use /config"));

    // Load every staff member's preferences into memory FIRST so that, from
    // the very first click, language lookups never touch the database.
    startPrefsRefresh();

    deployCommands().catch(e => console.error("Deploy error:", e));
    startPolling(client);
    startDailySummarySchedule(client);
    postOrUpdateConfigPanel(client).catch(e => console.error("Staff settings panel error:", e));
    startWebPanel(client);

    // If the gateway connection itself is unhealthy (frequent reconnects,
    // high ping), interactions arrive to our handler already several
    // seconds old through no fault of our own code — which is exactly what
    // makes deferReply fail with "Unknown interaction" no matter how fast
    // we react. Logging ping periodically makes that visible. (Only warns
    // above 1.5s: a ping of 500-1000ms is sluggish but not what breaks
    // interactions, and warning on it just buried the useful lines.)
    setInterval(() => {
        const ping = client.ws.ping;
        if (ping > 1500) {
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

// Custom IDs prefixed "cfg…" belong to the personal staff-settings panel
// (staffConfig.js), not the request-processing buttons (claim/len4/len6/
// wrong/unclaim/truecode/falsecode) in buttons.js — routed separately so
// the two handlers never need to know about each other.
const CONFIG_BUTTON_ACTIONS = new Set([
    "cfgopen", "cfgping", "cfgreset",
    "cfgclaims", "cfgstats", "cfghistory", "cfgdaily", "cfgback",
    "cfgrank", "cfgtestalert",
]);

client.on("interactionCreate", async interaction => {
    try {
        if (interaction.isButton()) {
            const action = interaction.customId.split("_")[0];
            if (CONFIG_BUTTON_ACTIONS.has(action)) {
                await handleConfigButton(interaction);
            } else {
                await handleButton(interaction);
            }
        } else if (interaction.isStringSelectMenu()) {
            await handleConfigSelect(interaction);
        } else if (interaction.isChatInputCommand()) {
            await handleSlash(interaction);
        }
    } catch (e) {
        console.error("Interaction error:", e);
        if (interaction.isRepliable?.() && !interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: t(peekLang(interaction.user.id), "generic_error"), flags: 64 }).catch(() => {});
        }
    }
});

// ─── Boot ────────────────────────────────────────────────────────────────────

await ensureSingleInstance();
startLockHeartbeat(client);
client.login(CONFIG.TOKEN);
