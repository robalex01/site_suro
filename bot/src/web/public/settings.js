/**
 * settings.js — personal settings page client
 *
 * The page's TEXT (labels, headings) is rendered server-side already in the
 * viewer's own language (server.js's renderSettingsPage uses the same
 * i18n.js as the Discord panel). This script only wires up interactivity
 * and fills in the read-only boxes (claims/stats/history/rank) — those are
 * left in plain English for now, see the chat for why.
 */

function $(sel) { return document.querySelector(sel); }
function T(key, vars) { return window.WEBI18N ? window.WEBI18N.t(key, vars) : key; }

// ─── View switching (Discord Settings / Web Settings) ────────────────────────────────

const VIEW_TITLE_KEYS = { discord: "nav_discord_settings", web: "nav_web_settings" };

function switchView(view) {
    document.querySelectorAll(".nav-item[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    document.querySelectorAll(".view[data-view-panel]").forEach(p => p.classList.toggle("active", p.dataset.viewPanel === view));
    const title = $("#view-title");
    if (title) title.textContent = T(VIEW_TITLE_KEYS[view] || view);
    localStorage.setItem("snaptech-settings-view", view);
}

document.querySelectorAll(".nav-item[data-view]").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
});
window.WEBI18N_READY?.then(() => switchView(localStorage.getItem("snaptech-settings-view") || "discord"));

// ─── Interface language (Web Settings) ───────────────────────────────────────

window.WEBI18N_READY?.then(() => {
    const select = $("#f-ui-language");
    if (!select) return;
    const current = window.WEBI18N?.lang || "en";
    select.innerHTML = (window.WEBI18N_AVAILABLE || []).map(l =>
        `<option value="${l.code}" ${l.code === current ? "selected" : ""}>${l.label}</option>`
    ).join("");
    select.addEventListener("change", () => {
        localStorage.setItem("snaptech-ui-lang", select.value);
        location.reload();
    });
});

function showToast(message) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    document.getElementById("toasts").appendChild(el);
    setTimeout(() => el.remove(), 6000);
}

async function post(path, body) {
    const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body || {}),
    });
    let data = {};
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok || data.success === false) {
        showToast(data.message || `Could not save (${res.status}).`);
        return null;
    }
    return data;
}

// ─── Language ─────────────────────────────────────────────────────────────────

$("#f-language").addEventListener("change", async (e) => {
    const ok = await post("/api/settings", { language: e.target.value });
    if (ok) location.reload(); // the whole page's text is server-rendered in that language
});

// ─── DM alerts toggle ───────────────────────────────────────────────────────────

$("#f-pings").addEventListener("click", async () => {
    const btn = $("#f-pings");
    const nowOn = btn.dataset.on === "true";
    const ok = await post("/api/settings", { receive_pings: !nowOn });
    if (ok) location.reload();
});

// ─── Daily summary toggle ───────────────────────────────────────────────────────

$("#f-daily").addEventListener("click", async () => {
    const btn = $("#f-daily");
    const nowOn = btn.dataset.on === "true";
    const ok = await post("/api/settings", { daily_summary: !nowOn });
    if (ok) location.reload();
});

// ─── Operator filter ────────────────────────────────────────────────────────────

$("#f-operators")?.addEventListener("change", async () => {
    const selected = [...document.querySelectorAll("#f-operators input:checked")].map(i => i.value);
    await post("/api/settings", { dm_alert_operators: selected });
});

// ─── Snooze ───────────────────────────────────────────────────────────────────

document.querySelectorAll("[data-snooze]").forEach(btn => {
    btn.addEventListener("click", async () => {
        const ok = await post("/api/settings", { snooze: btn.dataset.snooze });
        if (ok) {
            const until = ok.prefs?.snooze_until;
            $("#snooze-status").textContent = until && new Date(until) > new Date()
                ? `Snoozed until ${new Date(until).toLocaleString()}`
                : "Not snoozed.";
        }
    });
});

// ─── Test alert ─────────────────────────────────────────────────────────────────

$("#f-testalert").addEventListener("click", async () => {
    const res = await fetch("/api/settings/testalert", { method: "POST" });
    const data = await res.json();
    showToast(data.success ? "✅ Sent — check your DMs." : (data.message || "Could not send."));
});

// ─── Reset ────────────────────────────────────────────────────────────────────

$("#f-reset").addEventListener("click", async () => {
    if (!confirm("Reset all your settings to the defaults (English, DM alerts ON)?")) return;
    const ok = await post("/api/settings/reset");
    if (ok) location.reload();
});

// ─── Read-only info boxes ───────────────────────────────────────────────────────

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadClaims() {
    const box = $("#box-claims");
    const res = await fetch("/api/settings/claims");
    if (!res.ok) { box.textContent = "Could not load."; return; }
    const rows = await res.json();
    box.innerHTML = rows.length
        ? rows.map(r => `<div class="row"><span>${escapeHtml(r.phone)}</span><span>${escapeHtml(r.status)}</span></div>`).join("")
        : "No active claims.";
}

async function loadStats() {
    const box = $("#box-stats");
    const res = await fetch("/api/settings/stats");
    if (!res.ok) { box.textContent = "Could not load."; return; }
    const s = await res.json();
    box.innerHTML = `
        <div class="stat-grid">
            <div><b>${s.claims}</b>Claims</div>
            <div><b>${s.validations}</b>Validated</div>
            <div><b>${s.rejections}</b>Rejected</div>
            <div><b>${s.today}</b>Today</div>
        </div>`;
}

async function loadHistory() {
    const box = $("#box-history");
    const res = await fetch("/api/settings/history");
    if (!res.ok) { box.textContent = "Could not load."; return; }
    const rows = await res.json();
    box.innerHTML = rows.length
        ? rows.map(r => `<div class="row"><span>${escapeHtml(r.action)}${r.details?.phone ? " · " + escapeHtml(r.details.phone) : ""}</span><span>${new Date(r.created_at).toLocaleString()}</span></div>`).join("")
        : "No recent actions.";
}

async function loadRank() {
    const box = $("#box-rank");
    const res = await fetch("/api/settings/rank");
    if (!res.ok) { box.textContent = "Could not load."; return; }
    const r = await res.json();
    box.textContent = r.rank ? `#${r.rank} of ${r.total} — ${r.validations} validations` : "Not ranked yet — validate a code to appear on the leaderboard.";
}

loadClaims();
loadStats();
loadHistory();
loadRank();
