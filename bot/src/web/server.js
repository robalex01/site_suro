/**
 * web/server.js — staff web panel (Étape 1 : fondation)
 *
 * What this step delivers:
 *   - An HTTP + Socket.IO server, started FROM bot.js (see the call in
 *     bot.js's ClientReady handler) — same process, same host, so it's
 *     naturally reachable at Snaptech.sub-yorkhost.fr / 83.150.218.5:25021
 *     without needing a second deployment anywhere.
 *   - "Login with Discord" (OAuth2, scope: identify only). We deliberately
 *     do NOT request the `guilds.members.read` scope — instead, once we
 *     know who the person is, we ask the BOT's own already-connected
 *     client to fetch their GuildMember from CONFIG.GUILD_ID and reuse the
 *     exact same isStaff()/isOwner() checks as the Discord bot side
 *     (src/utils/permissions.js). One source of truth for "who can do
 *     what", not a second permission system to keep in sync.
 *   - A session cookie so they stay logged in across page loads.
 *   - A Socket.IO server wired to the SAME session, so a socket connection
 *     is authenticated exactly like an HTTP request — no separate token
 *     scheme to build or leak.
 *
 * What later steps add on top of this file (not yet here):
 *   - Real dashboard content: live request queue, claim/code/ban actions,
 *     leaderboard, personal settings — all reading/writing the SAME MySQL
 *     database the Discord bot already uses (src/database.js). That's what
 *     keeps Discord and the web panel "sans conflit" (no conflict): there
 *     is only ever one source of truth (the database), and whichever side
 *     changes something emits a Socket.IO event so the OTHER side updates
 *     live instead of drifting out of sync.
 *   - Emitting those Socket.IO events from polling.js / buttons.js / the
 *     web panel's own action routes, via getIO() exported below.
 */

import http from "node:http";
import crypto from "node:crypto";
import express from "express";
import session from "express-session";
import { Server as SocketIOServer } from "socket.io";
import { CONFIG } from "../config.js";
import { isStaff, isOwner } from "../utils/permissions.js";

let io = null;

/** Used by other modules (later steps) to push real-time updates without a circular import back into this file. */
export function getIO() {
    return io;
}

// ─── Session secret ─────────────────────────────────────────────────────────
//
// If WEB_SESSION_SECRET isn't set, we generate one for THIS process only.
// That works fine right up until the process restarts — at which point
// every cookie signed with the old secret becomes invalid and everyone is
// logged out. Printed loudly, once, so it actually gets copied into .env
// instead of silently costing every staff member their session on every
// redeploy.
function resolveSessionSecret() {
    if (CONFIG.WEB_SESSION_SECRET) return CONFIG.WEB_SESSION_SECRET;
    const generated = crypto.randomBytes(32).toString("hex");
    console.warn("⚠️  WEB_SESSION_SECRET not set — generated a temporary one for this run only.");
    console.warn("⚠️  Everyone will be logged out of the web panel on the next restart unless you add this to .env:");
    console.warn(`      WEB_SESSION_SECRET=${generated}`);
    return generated;
}

// ─── Discord OAuth2 ──────────────────────────────────────────────────────────

const OAUTH_REDIRECT_URI = `${CONFIG.WEB_BASE_URL}/callback`;

function buildAuthorizeUrl(state) {
    const params = new URLSearchParams({
        client_id:     CONFIG.CLIENT_ID,
        redirect_uri:  OAUTH_REDIRECT_URI,
        response_type: "code",
        scope:         "identify",
        state,
        prompt:        "none",
    });
    return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
    const body = new URLSearchParams({
        client_id:     CONFIG.CLIENT_ID,
        client_secret: CONFIG.DISCORD_CLIENT_SECRET,
        grant_type:    "authorization_code",
        code,
        redirect_uri:  OAUTH_REDIRECT_URI,
    });
    const res = await fetch("https://discord.com/api/oauth2/token", {
        method:  "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
    });
    if (!res.ok) throw new Error(`Discord token exchange failed: ${res.status} ${await res.text()}`);
    return res.json(); // { access_token, token_type, expires_in, refresh_token, scope }
}

async function fetchDiscordIdentity(accessToken) {
    const res = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) throw new Error(`Discord identity fetch failed: ${res.status}`);
    return res.json(); // { id, username, global_name, avatar, ... }
}

/**
 * Resolves a Discord user ID's permission level using the BOT's own
 * connection (not the user's OAuth2 token) — same role data, same
 * isStaff()/isOwner() logic as every Discord-side permission check.
 * Returns null if they're not even in the guild (can't determine roles).
 */
async function resolvePermissionLevel(client, discordUserId) {
    if (!CONFIG.GUILD_ID) return null; // no guild configured — can't check roles at all
    const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) return null;
    let member;
    try {
        member = await guild.members.fetch(discordUserId);
    } catch {
        return null; // not a member of the guild
    }
    return { owner: isOwner(member), staff: isStaff(member) };
}

// ─── App factory ─────────────────────────────────────────────────────────────

function requireStaff(req, res, next) {
    if (!req.session.user) {
        if (req.path.startsWith("/api/")) return res.status(401).json({ error: "not_authenticated" });
        return res.redirect("/login");
    }
    if (!req.session.user.staff) {
        if (req.path.startsWith("/api/")) return res.status(403).json({ error: "not_staff" });
        return res.status(403).send(renderPage("Access denied", `
            <p>Your Discord account (<strong>${escapeHtml(req.session.user.username)}</strong>) doesn't have staff access on this server.</p>
            <p><a href="/logout">Log out</a></p>
        `));
    }
    next();
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderPage(title, bodyHtml) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Snaptech Staff Panel</title>
<style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
        margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
        background: #0f1115; color: #e5e7eb;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .card {
        background: #171a21; border: 1px solid #262b36; border-radius: 12px;
        padding: 32px 40px; max-width: 480px; width: 90%; text-align: center;
    }
    h1 { font-size: 1.4rem; margin: 0 0 12px; }
    p { color: #9ca3af; line-height: 1.5; }
    a.btn {
        display: inline-block; margin-top: 16px; padding: 10px 22px; border-radius: 8px;
        background: #5865F2; color: #fff; text-decoration: none; font-weight: 600;
    }
    a.btn:hover { background: #4752c4; }
    a { color: #5865F2; }
    code { background: #0f1115; padding: 2px 6px; border-radius: 4px; }
</style>
</head>
<body>
    <div class="card">
        <h1>${escapeHtml(title)}</h1>
        ${bodyHtml}
    </div>
</body>
</html>`;
}

export function startWebPanel(client) {
    if (!CONFIG.WEB_ENABLED) {
        console.log("ℹ️  Web panel disabled (WEB_ENABLED=0) — skipping.");
        return null;
    }
    if (!CONFIG.DISCORD_CLIENT_SECRET) {
        console.error("❌ Web panel NOT started — DISCORD_CLIENT_SECRET is missing (see the warning above).");
        return null;
    }

    const app = express();
    // Behind a reverse proxy (if one's ever added in front of this port),
    // this lets req.protocol / secure cookies reflect X-Forwarded-Proto
    // correctly instead of always seeing plain HTTP from the proxy hop.
    app.set("trust proxy", 1);

    const sessionMiddleware = session({
        secret:            resolveSessionSecret(),
        resave:            false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            sameSite: "lax",
            // Only marked secure (HTTPS-only cookie) if WEB_BASE_URL is itself
            // https — an https cookie sent over a plain http connection is
            // silently dropped by the browser, which would make login look
            // like it "does nothing". Flip this only once the domain is
            // actually served over TLS.
            secure:   CONFIG.WEB_BASE_URL.startsWith("https"),
            maxAge:   1000 * 60 * 60 * 24 * 7, // 7 days
        },
    });
    app.use(sessionMiddleware);
    app.use(express.json());

    // ── Auth routes ──────────────────────────────────────────────────────────

    app.get("/login", (req, res) => {
        const state = crypto.randomBytes(16).toString("hex");
        req.session.oauthState = state;
        res.redirect(buildAuthorizeUrl(state));
    });

    app.get("/callback", async (req, res) => {
        const { code, state, error } = req.query;
        if (error) return res.status(400).send(renderPage("Login cancelled", `<p>${escapeHtml(error)}</p><a class="btn" href="/login">Try again</a>`));
        if (!code || !state || state !== req.session.oauthState) {
            return res.status(400).send(renderPage("Login failed", `<p>Invalid or expired login attempt.</p><a class="btn" href="/login">Try again</a>`));
        }
        delete req.session.oauthState;

        try {
            const token    = await exchangeCodeForToken(code);
            const identity = await fetchDiscordIdentity(token.access_token);
            const perms    = await resolvePermissionLevel(client, identity.id);

            if (!perms) {
                return res.status(403).send(renderPage("Access denied", `
                    <p><strong>${escapeHtml(identity.username)}</strong>, you need to be a member of the Discord server to use this panel.</p>
                    <a class="btn" href="/login">Try again</a>
                `));
            }

            req.session.user = {
                id:       identity.id,
                username: identity.global_name || identity.username,
                avatar:   identity.avatar
                    ? `https://cdn.discordapp.com/avatars/${identity.id}/${identity.avatar}.png`
                    : null,
                owner:    perms.owner,
                staff:    perms.staff,
                loggedInAt: Date.now(),
            };

            if (!perms.staff) {
                return res.status(403).send(renderPage("Access denied", `
                    <p><strong>${escapeHtml(req.session.user.username)}</strong>, your Discord account doesn't have staff access on this server.</p>
                    <a href="/logout">Log out</a>
                `));
            }

            res.redirect("/");
        } catch (e) {
            console.error("❌ Web panel OAuth2 callback error:", e.message || e);
            res.status(500).send(renderPage("Login error", `<p>Something went wrong talking to Discord. Try again in a moment.</p><a class="btn" href="/login">Try again</a>`));
        }
    });

    app.get("/logout", (req, res) => {
        req.session.destroy(() => res.redirect("/"));
    });

    // ── Dashboard shell (Étape 1: placeholder — real content lands in the next steps) ──

    app.get("/", (req, res) => {
        if (!req.session.user) {
            return res.send(renderPage("Snaptech Staff Panel", `
                <p>Sign in with your Discord account to continue. You need the Staff role on the Snaptech server.</p>
                <a class="btn" href="/login">Login with Discord</a>
            `));
        }
        if (!req.session.user.staff) {
            return res.status(403).send(renderPage("Access denied", `
                <p><strong>${escapeHtml(req.session.user.username)}</strong>, your Discord account doesn't have staff access on this server.</p>
                <a href="/logout">Log out</a>
            `));
        }
        res.send(renderPage("Dashboard", `
            <p>Signed in as <strong>${escapeHtml(req.session.user.username)}</strong>
               ${req.session.user.owner ? " · <span style=\"color:#f59e0b\">Owner</span>" : " · <span style=\"color:#3b82f6\">Staff</span>"}</p>
            <p id="status" style="color:#9ca3af">Connecting…</p>
            <p style="margin-top:24px;"><a href="/logout">Log out</a></p>
            <script src="/socket.io/socket.io.js"></script>
            <script>
                const socket = io();
                const status = document.getElementById("status");
                socket.on("connect", () => { status.textContent = "🟢 Live connection established."; status.style.color = "#10b981"; });
                socket.on("disconnect", () => { status.textContent = "🔴 Disconnected — retrying…"; status.style.color = "#ef4444"; });
            </script>
        `));
    });

    // ── HTTP + Socket.IO ─────────────────────────────────────────────────────

    const httpServer = http.createServer(app);
    io = new SocketIOServer(httpServer, {
        cors: { origin: CONFIG.WEB_BASE_URL, credentials: true },
    });

    // Shares the exact same session as the HTTP side — a socket is only ever
    // authenticated because the browser's existing login cookie says so, not
    // via any separate token.
    const wrapMiddleware = (middleware) => (socket, next) => middleware(socket.request, {}, next);
    io.engine.use(wrapMiddleware(sessionMiddleware));
    io.use((socket, next) => {
        const user = socket.request.session?.user;
        if (!user || !user.staff) return next(new Error("unauthorized"));
        socket.data.user = user;
        next();
    });

    io.on("connection", (socket) => {
        console.log(`🌐 Web panel: ${socket.data.user.username} connected (${socket.id})`);
        socket.on("disconnect", () => {
            console.log(`🌐 Web panel: ${socket.data.user.username} disconnected (${socket.id})`);
        });
    });

    httpServer.listen(CONFIG.WEB_PORT, CONFIG.WEB_HOST, () => {
        console.log(`🌐 Web panel listening on ${CONFIG.WEB_HOST}:${CONFIG.WEB_PORT} — ${CONFIG.WEB_BASE_URL}`);
    });

    httpServer.on("error", (e) => {
        console.error(`❌ Web panel server error (port ${CONFIG.WEB_PORT}):`, e.message);
    });

    return { app, httpServer, io };
}
