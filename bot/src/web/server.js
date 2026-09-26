/**
 * web/server.js — staff web panel
 *
 * - An HTTP + Socket.IO server, started FROM bot.js — same process, same
 *   host, so it's naturally reachable at Snaptech.sub-yorkhost.fr /
 *   83.150.218.5:25021 without needing a second deployment anywhere.
 * - "Login with Discord" (OAuth2, scope: identify only). We deliberately do
 *   NOT request the `guilds.members.read` scope — instead, once we know who
 *   the person is, we ask the BOT's own already-connected client to fetch
 *   their GuildMember from CONFIG.GUILD_ID and reuse the exact same
 *   isStaff()/isOwner() checks as the Discord bot side
 *   (src/utils/permissions.js). One source of truth for "who can do what".
 * - A Socket.IO server wired to the SAME session as the HTTP side, so a
 *   socket connection is authenticated exactly like an HTTP request.
 *
 * Display text note: the account tier internally called "staff" (env var
 * STAFF_ROLE_ID, isStaff()) is always shown to the person as "Access" in
 * every page/label here — only the variable/config names stay "staff"
 * internally. The product name "Snaptech" is deliberately never shown on
 * any page — titles/branding just say "Access Panel".
 */

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import express from "express";
import session from "express-session";
import { Server as SocketIOServer } from "socket.io";
import { CONFIG, OPERATOR_GROUPS } from "../config.js";
import { isStaff, isOwner } from "../utils/permissions.js";
import { getPrefs } from "../utils/userPrefs.js";
import { t } from "../utils/i18n.js";
import { createApiRouter } from "./api.js";
import {
  createPayRouter,
  initPayments,
  hasValidAccess,
  getGrant,
} from "./payments.js";
import {
  createPayRouter,
  initPayments,
  hasValidAccess,
  getGrant,
} from "./payments.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const LOCALES_DIR = path.join(__dirname, "locales");

let io = null;

/** Used by other modules to push real-time updates without a circular import back into this file. */
export function getIO() {
  return io;
}

// ─── Session secret ─────────────────────────────────────────────────────────
function resolveSessionSecret() {
  if (CONFIG.WEB_SESSION_SECRET) return CONFIG.WEB_SESSION_SECRET;
  const generated = crypto.randomBytes(32).toString("hex");
  console.warn(
    "⚠️  WEB_SESSION_SECRET not set — generated a temporary one for this run only.",
  );
  console.warn(
    "⚠️  Everyone will be logged out of the web panel on the next restart unless you add this to .env:",
  );
  console.warn(`      WEB_SESSION_SECRET=${generated}`);
  return generated;
}

// ─── Discord OAuth2 ──────────────────────────────────────────────────────────

const OAUTH_REDIRECT_URI = `${CONFIG.WEB_BASE_URL}/callback`;

function buildAuthorizeUrl(state) {
  const params = new URLSearchParams({
    client_id: CONFIG.CLIENT_ID,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: "identify guilds.join",
    state,
    prompt: "none",
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    client_id: CONFIG.CLIENT_ID,
    client_secret: CONFIG.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: OAUTH_REDIRECT_URI,
  });
  const res = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok)
    throw new Error(
      `Discord token exchange failed: ${res.status} ${await res.text()}`,
    );
  return res.json();
}

async function fetchDiscordIdentity(accessToken) {
  const res = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Discord identity fetch failed: ${res.status}`);
  return res.json();
}

/**
 * Resolves a Discord user ID's permission level using the BOT's own
 * connection (not the user's OAuth2 token) — same role data, same
 * isStaff()/isOwner() logic as every Discord-side permission check.
 */
async function resolvePermissionLevel(client, discordUserId) {
  if (!CONFIG.GUILD_ID) return null;
  const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
  if (!guild) return null;
  let member;
  try {
    member = await guild.members.fetch(discordUserId);
  } catch {
    return null;
  }
  return { owner: isOwner(member), staff: isStaff(member) };
}

// ─── App factory ─────────────────────────────────────────────────────────────

async function requireStaff(req, res, next) {
  const isApi = req.originalUrl.startsWith("/api/");
  if (!req.session.user) {
    if (isApi) return res.status(401).json({ error: "not_authenticated" });
    return res.redirect("/login");
  }
  if (!(await hasValidAccess(req.session.user))) {
    if (isApi) return res.status(403).json({ error: "not_access" });
    return res.status(403).send(renderNoAccess(req.session.user));
  }
  next();
}

function renderNoAccess(user) {
  return renderPage(
    "No access",
    `
        <p><strong>${escapeHtml(user.username)}</strong>, you don't have access to this panel.</p>
        <a class="btn btn-buy" href="/buy">Buy access</a>
        <p style="margin-top:16px"><a href="/logout">Log out</a></p>
    `,
  );
}

function escapeHtml(s) {
  return String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
}

// ─── Icons ───────────────────────────────────────────────────────────────────────
// Inline SVG, Lucide-style (24x24, stroke-based) — no icon font or npm
// dependency needed. Replaces every emoji in the interface.
const ICON_PATHS = {
  grid: `<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>`,
  inbox: `<path d="M4 4h16v10l-2.5 4h-11L4 14V4Z"/><path d="M4 13h5l1.2 2h3.6l1.2-2h5"/>`,
  progress: `<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>`,
  unlock: `<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.8"/>`,
  layers: `<path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z"/><path d="m4 12 8 4.5 8-4.5"/><path d="m4 16.5 8 4.5 8-4.5"/>`,
  trophy: `<path d="M8 4h8v4a4 4 0 0 1-8 0V4Z"/><path d="M6 5H4.5A1.5 1.5 0 0 0 3 6.5v0A2.5 2.5 0 0 0 5.5 9H8"/><path d="M18 5h1.5A1.5 1.5 0 0 1 21 6.5v0A2.5 2.5 0 0 1 18.5 9H16"/><path d="M12 12v3"/><path d="M9 20h6"/><path d="M10.5 15h3l.5 5h-4l.5-5Z"/>`,
  settings: `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z"/>`,
  globe: `<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 4 9 15 15 0 0 1-4 9 15 15 0 0 1-4-9 15 15 0 0 1 4-9Z"/>`,
  arrowLeft: `<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>`,
  logOut: `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>`,
  moon: `<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>`,
  message: `<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10Z"/>`,
};

function icon(name, size = 16) {
  return `<svg class="icon" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ""}</svg>`;
}

function renderPage(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — Access Panel</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body {
        margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
        background: #0b0d12; color: #e7e9ee;
        font-family: "IBM Plex Sans", -apple-system, "Segoe UI", sans-serif;
    }
    .card {
        background: #12151c; border: 1px solid #242836; border-radius: 10px;
        padding: 32px 40px; max-width: 480px; width: 90%; text-align: center;
    }
    h1 { font-size: 1.3rem; margin: 0 0 12px; font-weight: 600; }
    p { color: #8991a3; line-height: 1.55; }
    a.btn {
        display: inline-block; margin-top: 16px; padding: 10px 22px; border-radius: 6px;
        background: #6c8cff; color: #0b0d12; text-decoration: none; font-weight: 600;
    }
    a.btn:hover { opacity: 0.88; text-decoration: none; }
    a { color: #6c8cff; }
    code { font-family: "IBM Plex Mono", monospace; background: #0b0d12; padding: 2px 6px; border-radius: 4px; }

    a.btn-buy { background: #00e676; color: #03140a; font-size: 1.05rem; padding: 13px 36px; box-shadow: 0 0 22px #00e67666;
    }
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

function renderDashboard(user, grant = null) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard — Access Panel</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/style.css">
<script>(function(){try{document.documentElement.setAttribute("data-theme",localStorage.getItem("snaptech-theme")||"dark");var l=localStorage.getItem("snaptech-ui-lang");if(l==="ar")document.documentElement.dir="rtl";}catch(e){}})();</script>
</head>
<body>
<div class="app-shell">
    <aside class="sidebar">
        <div class="brand">${icon("grid", 18)} Access Panel</div>
        <nav>
            <div class="nav-label">Queue</div>
            <button class="nav-item active" data-view="pending">${icon("inbox")}<span class="nav-label-text" data-i18n="nav_unclaimed">Unclaimed</span><span class="count" id="count-pending">0</span></button>
            <button class="nav-item" data-view="active">${icon("progress")}<span class="nav-label-text" data-i18n="nav_inprogress">In Progress</span><span class="count" id="count-active">0</span></button>
            <button class="nav-item" data-view="waiting">${icon("clock")}<span class="nav-label-text" data-i18n="nav_awaiting">Awaiting Code</span><span class="count" id="count-waiting">0</span></button>
            <button class="nav-item" data-view="submitted">${icon("unlock")}<span class="nav-label-text" data-i18n="nav_submitted">Code Submitted</span><span class="count" id="count-submitted">0</span></button>
            ${user.owner ? `<button class="nav-item" data-view="all">${icon("layers")}<span class="nav-label-text" data-i18n="nav_all">All Active</span><span class="count" id="count-all">0</span></button>` : ""}
            <div class="nav-label">Other</div>
            <button class="nav-item" data-view="leaderboard">${icon("trophy")}<span class="nav-label-text" data-i18n="nav_leaderboard">Leaderboard</span></button>
            <a class="nav-item" href="/settings">${icon("settings")}<span class="nav-label-text" data-i18n="nav_settings">Settings</span></a>
            <div class="nav-label">Access</div>
            <a class="nav-item" href="/buy">${icon("clock")}<span class="nav-label-text">Add time</span></a>
        </nav>
        <div class="sidebar-spacer"></div>
        <button class="theme-toggle" id="theme-toggle"><span class="theme-icon">${icon("sun")}</span><span class="label">Light mode</span></button>
        <div class="user-box">
            ${user.avatar ? `<img class="avatar" src="${user.avatar}" alt="">` : ""}
            <div style="flex:1;min-width:0;">
                <div class="name">${escapeHtml(user.username)}</div>
                <span class="badge-role ${user.owner ? "badge-owner" : "badge-staff"}">${user.owner ? "Owner" : "Access"}</span>
                ${grant && new Date(grant.expires_at) > new Date() ? `<div class="hint" style="font-size:.72rem">until ${escapeHtml(new Date(grant.expires_at).toUTCString())}</div>` : ""}
            </div>
            <a href="/logout">${icon("logOut", 14)}<span data-i18n="logout">Log out</span></a>
        </div>
    </aside>
    <div class="main-area">
        <div class="topbar">
            <h1 id="view-title" data-i18n="title_unclaimed">Unclaimed</h1>
            <span id="conn" data-i18n="conn_connecting">Connecting…</span>
        </div>
        <main class="content">
            <div class="view active" data-view-panel="pending">
                <div class="view-header"><h2 data-i18n="header_unclaimed">Unclaimed requests</h2><span class="hint" id="hint-pending">Oldest first · requests older than ${CONFIG.UNCLAIMED_MAX_AGE_MINUTES} min are hidden</span></div>
                <div class="queue" id="col-pending"></div>
            </div>
            <div class="view" data-view-panel="active">
                <div class="view-header"><h2 data-i18n="header_inprogress">My in-progress requests</h2><span class="hint" data-i18n="hint_inprogress">Choose a code length</span></div>
                <div class="queue" id="col-active"></div>
            </div>
            <div class="view" data-view-panel="waiting">
                <div class="view-header"><h2 data-i18n="header_waiting">My requests awaiting code</h2></div>
                <div class="queue" id="col-waiting"></div>
            </div>
            <div class="view" data-view-panel="submitted">
                <div class="view-header"><h2 data-i18n="header_submitted">My code submissions</h2><span class="hint" data-i18n="hint_submitted">Validate or reject</span></div>
                <div class="queue" id="col-submitted"></div>
            </div>
            ${
              user.owner
                ? `
            <div class="view" data-view-panel="all">
                <div class="view-header"><h2 data-i18n="header_all">All active requests</h2><span class="hint" data-i18n="hint_all">Owner view — every claim, not just yours</span></div>
                <div class="queue" id="col-all"></div>
            </div>`
                : ""
            }
            <div class="view" data-view-panel="leaderboard">
                <div class="view-header"><h2 data-i18n="header_leaderboard">Leaderboard</h2><span class="hint">By validated codes</span></div>
                <ul class="leaderboard" id="leaderboard"></ul>
            </div>
        </main>
        <footer class="app-footer">Access Panel · <strong>By Voldemort</strong></footer>
    </div>
</div>
<div id="toasts"></div>
<script src="/socket.io/socket.io.js"></script>
<script>window.__ME__ = { id: "${user.id}", owner: ${user.owner ? "true" : "false"}, unclaimedMaxAgeMinutes: ${CONFIG.UNCLAIMED_MAX_AGE_MINUTES} };</script>
<script src="/static/webi18n.js"></script>
<script src="/static/theme.js"></script>
<script src="/static/app.js"></script>
</body>
</html>`;
}

const SETTINGS_LANGUAGES = [
  { value: "en", label: "English", emoji: "🇬🇧" },
  { value: "fr", label: "Français", emoji: "🇫🇷" },
  { value: "pl", label: "Polski", emoji: "🇵🇱" },
  { value: "es", label: "Español", emoji: "🇪🇸" },
  { value: "ar", label: "العربية", emoji: "🇸🇦" },
];

function renderSettingsPage(user, prefs, operatorGroups) {
  const lang = prefs.language || "en";
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(t(lang, "settings_title"))} — Access Panel</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/style.css">
<link rel="stylesheet" href="/static/settings.css">
<script>(function(){try{document.documentElement.setAttribute("data-theme",localStorage.getItem("snaptech-theme")||"dark");var l=localStorage.getItem("snaptech-ui-lang");if(l==="ar")document.documentElement.dir="rtl";}catch(e){}})();</script>
</head>
<body>
<div class="app-shell">
    <aside class="sidebar">
        <div class="brand">${icon("grid", 18)} Access Panel</div>
        <nav>
            <a class="nav-item" href="/">${icon("arrowLeft")}<span class="nav-label-text" data-i18n="nav_back_dashboard">Dashboard</span></a>
            <div class="nav-label">Settings</div>
            <button class="nav-item active" data-view="discord">${icon("message")}<span class="nav-label-text" data-i18n="nav_discord_settings">Discord Settings</span></button>
            <button class="nav-item" data-view="web">${icon("globe")}<span class="nav-label-text" data-i18n="nav_web_settings">Web Settings</span></button>
        </nav>
        <div class="sidebar-spacer"></div>
        <button class="theme-toggle" id="theme-toggle"><span class="theme-icon">${icon("sun")}</span><span class="label">Light mode</span></button>
        <div class="user-box">
            ${user.avatar ? `<img class="avatar" src="${user.avatar}" alt="">` : ""}
            <div style="flex:1;min-width:0;">
                <div class="name">${escapeHtml(user.username)}</div>
                <span class="badge-role ${user.owner ? "badge-owner" : "badge-staff"}">${user.owner ? "Owner" : "Access"}</span>
            </div>
            <a href="/logout">${icon("logOut", 14)}<span data-i18n="logout">Log out</span></a>
        </div>
    </aside>
    <div class="main-area">
        <div class="topbar"><h1 id="view-title" data-i18n="nav_discord_settings">Discord Settings</h1></div>
        <main class="content settings">

        <div class="view active" data-view-panel="discord">
            <p class="note">${escapeHtml(t(lang, "settings_note_public"))}</p>

            <section class="panel">
                <label>${escapeHtml(t(lang, "settings_language_label"))}</label>
                <select id="f-language">
                    ${SETTINGS_LANGUAGES.map((l) => `<option value="${l.value}" ${l.value === lang ? "selected" : ""}>${l.emoji} ${l.label}</option>`).join("")}
                </select>
            </section>

            <section class="panel row">
                <div>
                    <label>${escapeHtml(t(lang, "settings_dmalert_label"))}</label>
                    <p class="note">${escapeHtml(t(lang, "settings_dmalert_note"))}</p>
                </div>
                <button id="f-pings" class="btn ${prefs.receive_pings ? "btn-danger" : "btn-success"}" data-on="${prefs.receive_pings}">
                    ${prefs.receive_pings ? escapeHtml(t(lang, "settings_dmalert_disable_btn")) : escapeHtml(t(lang, "settings_dmalert_enable_btn"))}
                </button>
            </section>

            <section class="panel">
                <label>${escapeHtml(t(lang, "settings_opfilter_label"))}</label>
                <div id="f-operators" class="chips">
                    ${operatorGroups.map((g) => `<label class="chip"><input type="checkbox" value="${g}" ${(prefs.dm_alert_operators || "").split(",").includes(g) ? "checked" : ""}> ${escapeHtml(t(lang, `op_group_${g}`))}</label>`).join("")}
                </div>
                <p class="note">${escapeHtml(t(lang, "settings_opfilter_all"))} if none selected.</p>
            </section>

            <section class="panel row">
                <div>
                    <label>${escapeHtml(t(lang, "settings_daily_label"))}</label>
                </div>
                <button id="f-daily" class="btn ${prefs.daily_summary ? "btn-danger" : "btn-success"}" data-on="${prefs.daily_summary}">
                    ${prefs.daily_summary ? escapeHtml(t(lang, "settings_daily_disable_btn")) : escapeHtml(t(lang, "settings_daily_enable_btn"))}
                </button>
            </section>

            <section class="panel">
                <label>${escapeHtml(t(lang, "settings_snooze_label"))}</label>
                <div class="actions">
                    <button class="btn btn-secondary" data-snooze="1h">1h</button>
                    <button class="btn btn-secondary" data-snooze="4h">4h</button>
                    <button class="btn btn-secondary" data-snooze="8h">8h</button>
                    <button class="btn btn-secondary" data-snooze="24h">24h</button>
                    <button class="btn btn-danger" data-snooze="clear">${escapeHtml(t(lang, "snooze_opt_clear"))}</button>
                </div>
                <p class="note" id="snooze-status"></p>
            </section>

            <section class="panel actions">
                <button id="f-testalert" class="btn btn-secondary">${escapeHtml(t(lang, "settings_btn_testalert"))}</button>
                <button id="f-reset" class="btn btn-danger">${escapeHtml(t(lang, "settings_reset_btn"))}</button>
            </section>

            <div class="section-title">${escapeHtml(t(lang, "settings_btn_claims"))}</div>
            <div id="box-claims" class="info-box"></div>

            <div class="section-title">${escapeHtml(t(lang, "settings_btn_stats"))}</div>
            <div id="box-stats" class="info-box"></div>

            <div class="section-title">${escapeHtml(t(lang, "settings_btn_history"))}</div>
            <div id="box-history" class="info-box"></div>

            <div class="section-title">${escapeHtml(t(lang, "settings_btn_rank"))}</div>
            <div id="box-rank" class="info-box"></div>
        </div>

        <div class="view" data-view-panel="web">
            <p class="note" data-i18n="web_settings_note">Display preferences for this browser only — not synced to Discord or any other device.</p>
            <section class="panel">
                <label data-i18n="theme_label">Theme</label>
                <div class="actions">
                    <button class="btn btn-secondary" data-theme-set="dark" data-i18n="theme_dark">Dark</button>
                    <button class="btn btn-secondary" data-theme-set="light" data-i18n="theme_light">Light</button>
                </div>
            </section>
            <section class="panel">
                <label data-i18n="ui_language_label">Interface language</label>
                <select id="f-ui-language"></select>
            </section>
        </div>

        </main>
        <footer class="app-footer">Access Panel · <strong>By Voldemort</strong></footer>
    </div>
</div>
<div id="toasts"></div>
<script src="/static/webi18n.js"></script>
<script src="/static/theme.js"></script>
<script src="/static/settings.js"></script>
</body>
</html>`;
}

export function startWebPanel(client) {
  if (!CONFIG.WEB_ENABLED) {
    console.log("ℹ️  Web panel disabled (WEB_ENABLED=0) — skipping.");
    return null;
  }
  if (!CONFIG.DISCORD_CLIENT_SECRET) {
    console.error(
      "❌ Web panel NOT started — DISCORD_CLIENT_SECRET is missing (see the warning above).",
    );
    return null;
  }

  const app = express();
  app.set("trust proxy", 1);

  const sessionMiddleware = session({
    secret: resolveSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: CONFIG.WEB_BASE_URL.startsWith("https"),
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  });
  app.use(sessionMiddleware);
  app.use(express.json());
  app.use("/static", express.static(PUBLIC_DIR));
  app.use("/locales", express.static(LOCALES_DIR));
  initPayments().catch((e) =>
    console.error("❌ [payments] init failed:", e.message),
  );
  app.use("/", createPayRouter(client));
  app.use("/api", requireStaff, createApiRouter(client));

  // ── Auth routes ──────────────────────────────────────────────────────────

  app.get("/login", (req, res) => {
    const state = crypto.randomBytes(16).toString("hex");
    req.session.oauthState = state;
    res.redirect(buildAuthorizeUrl(state));
  });

  app.get("/callback", async (req, res) => {
    const { code, state, error } = req.query;
    if (error)
      return res
        .status(400)
        .send(
          renderPage(
            "Login cancelled",
            `<p>${escapeHtml(error)}</p><a class="btn" href="/login">Try again</a>`,
          ),
        );
    if (!code || !state || state !== req.session.oauthState) {
      return res
        .status(400)
        .send(
          renderPage(
            "Login failed",
            `<p>Invalid or expired login attempt.</p><a class="btn" href="/login">Try again</a>`,
          ),
        );
    }
    delete req.session.oauthState;

    try {
      const token = await exchangeCodeForToken(code);
      const identity = await fetchDiscordIdentity(token.access_token);
      const perms = await resolvePermissionLevel(client, identity.id);

      if (!perms) {
        return res.status(403).send(
          renderPage(
            "Access denied",
            `
                    <p><strong>${escapeHtml(identity.username)}</strong>, you need to be a member of the Discord server to use this panel.</p>
                    <a class="btn" href="/login">Try again</a>
                `,
          ),
        );
      }

      req.session.user = {
        id: identity.id,
        username: identity.global_name || identity.username,
        avatar: identity.avatar
          ? `https://cdn.discordapp.com/avatars/${identity.id}/${identity.avatar}.png`
          : null,
        owner: perms?.owner || false,
        staff: perms?.staff || false,
        member: !!perms,
        accessToken: token.access_token, // ← nécessaire à l'auto-join (guilds.join)
        loggedInAt: Date.now(),
      };
      return res.redirect("/");
    } catch (e) {
      console.error("❌ Web panel OAuth2 callback error:", e.message || e);
      res
        .status(500)
        .send(
          renderPage(
            "Login error",
            `<p>Something went wrong talking to Discord. Try again in a moment.</p><a class="btn" href="/login">Try again</a>`,
          ),
        );
    }
  });

  app.get("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/"));
  });

  // ── Dashboard ──

  app.get("/", async (req, res) => {
    if (!req.session.user) {
      return res.send(
        renderPage(
          "Access Panel",
          `
            <p>Sign in with your Discord account to continue.</p>
            <a class="btn" href="/login">Login with Discord</a>`,
        ),
      );
    }
    if (!(await hasValidAccess(req.session.user)))
      return res.status(403).send(renderNoAccess(req.session.user));
    const grant = await getGrant(req.session.user.id);
    res.send(renderDashboard(req.session.user, grant));
  });

  app.get("/settings", async (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    if (!(await hasValidAccess(req.session.user)))
      return res.status(403).send(renderNoAccess(req.session.user));

    try {
      const prefs = await getPrefs(req.session.user.id);
      res.send(renderSettingsPage(req.session.user, prefs, OPERATOR_GROUPS));
    } catch (e) {
      console.error("❌ [web] /settings render error:", e.message);
      res
        .status(500)
        .send(
          renderPage(
            "Error",
            `<p>Could not load your settings right now. Try again in a moment.</p><a class="btn" href="/">Back to dashboard</a>`,
          ),
        );
    }
  });

  // ── HTTP + Socket.IO ─────────────────────────────────────────────────────

  const httpServer = http.createServer(app);
  io = new SocketIOServer(httpServer, {
    cors: { origin: CONFIG.WEB_BASE_URL, credentials: true },
  });

  io.engine.use(sessionMiddleware);
  io.use((socket, next) => {
    const user = socket.request.session?.user;
    if (!user || !user.staff) return next(new Error("unauthorized"));
    socket.data.user = user;
    next();
  });

  io.on("connection", (socket) => {
    console.log(
      `🌐 Web panel: ${socket.data.user.username} connected (${socket.id})`,
    );
    socket.on("disconnect", () => {
      console.log(
        `🌐 Web panel: ${socket.data.user.username} disconnected (${socket.id})`,
      );
    });
  });

  httpServer.listen(CONFIG.WEB_PORT, CONFIG.WEB_HOST, () => {
    console.log(
      `🌐 Web panel listening on ${CONFIG.WEB_HOST}:${CONFIG.WEB_PORT} — ${CONFIG.WEB_BASE_URL}`,
    );
  });

  httpServer.on("error", (e) => {
    console.error(
      `❌ Web panel server error (port ${CONFIG.WEB_PORT}):`,
      e.message,
    );
  });

  return { app, httpServer, io };
}
