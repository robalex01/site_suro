const API_VERIFY = '/api/verify-code';

function getParam(name) {
    return new URL(window.location.href).searchParams.get(name);
}

const phone = getParam('phone') || '--';
const length = parseInt(getParam('length')) || 6;

document.getElementById('codePhone').textContent = phone;

// Générer les inputs dynamiquement
const container = document.getElementById('codeInputs');
for (let i = 0; i < length; i++) {
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 1;
    input.className = 'code-digit';
    input.dataset.index = i;
    container.appendChild(input);
}

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

    if (code.length !== length) {
        status.textContent = `⚠️ Veuillez entrer les ${length} chiffres`;
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
            inputs.forEach(i => { i.value = ''; });
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

window.verifyCode = verifyCode;
