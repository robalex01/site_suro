/**
 * web/payments.js — achat d'accès via Litecoin
 *
 * Flux : /buy (choix durée) → /pay (méthode, LTC) → /pay/checkout
 * (facture : montant LTC unique, adresse, QR) → polling /api/pay/status/:id
 * (détection + confirmation on-chain) → /pay/success (rôle Discord, ajout
 * de temps, reload du panel).
 *
 * Vérification forte : montant unique par facture (offset litoshi aléatoire,
 * UNIQUE en DB) + exigence de 1 confirmation + interdiction de réutiliser
 * un txid déjà crédité.
 */

import crypto from "node:crypto";
import express from "express";
import QRCode from "qrcode";
import { CONFIG } from "../config.js";
import { sql, query } from "../database.js";

// ─── Catalog ────────────────────────────────────────────────────────────────
export const TIERS = {
    day1:   { label: "1 Day",   days: 1,  eur: 9.99 },
    day3:   { label: "3 Days",  days: 3,  eur: 29.99 },
    week1:  { label: "1 Week",  days: 7,  eur: 59.99 },
    month1: { label: "1 Month", days: 30, eur: 199.99 },
};

const LTC_ADDR        = (process.env.LTC_ADDRESS || "Lb7eG6DArGd5reWsXxs6HsDVtWxzsQzMie").trim();
const INVITE_URL      = process.env.DISCORD_INVITE_URL || "https://discord.gg/yvgFtZneHm";
const REQUIRED_CONFS  = Math.max(1, parseInt(process.env.LTC_CONFIRMATIONS, 10) || 1);
const INVOICE_TTL_MIN = 60;
const MATCH_TOLERANCE = 0.0002; // LTC — accepte un micro overpay, l'offset unique garde l'attribution
const SAT             = 1e8;

const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ─── Taux EUR→LTC (24/7, rafraîchi en tâche de fond) ─────────────────────────
let rateState = { eur: 0, at: 0 };

async function refreshRate() {
    try {
        const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=litecoin&vs_currencies=eur", { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
            const j = await r.json();
            if (j?.litecoin?.eur) { rateState = { eur: +j.litecoin.eur, at: Date.now() }; return; }
        }
    } catch { /* try next source */ }
    try {
        const r = await fetch("https://api.kraken.com/0/public/Ticker?pair=LTCEUR", { signal: AbortSignal.timeout(8000) });
        if (r.ok) {
            const j = await r.json();
            const k = Object.keys(j.result || {})[0];
            if (k) { rateState = { eur: +j.result[k].c[0], at: Date.now() }; }
        }
    } catch { /* keep last known rate */ }
}

async function getLtcRate() {
    if (!rateState.eur || Date.now() - rateState.at > 120_000) await refreshRate();
    if (!rateState.eur) throw new Error("Taux LTC/EUR indisponible pour le moment — réessaie dans une minute.");
    return rateState.eur;
}

// ─── Schéma ─────────────────────────────────────────────────────────────────
async function initSchema() {
    await query(`CREATE TABLE IF NOT EXISTS access_grants (
        discord_id VARCHAR(32) NOT NULL PRIMARY KEY,
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    await query(`CREATE TABLE IF NOT EXISTS web_payments (
        id VARCHAR(36) NOT NULL PRIMARY KEY,
        discord_id VARCHAR(32) NOT NULL,
        tier_key VARCHAR(16) NOT NULL,
        eur DECIMAL(10,2) NOT NULL,
        ltc_amount DECIMAL(20,8) NOT NULL,
        method VARCHAR(8) NOT NULL DEFAULT 'ltc',
        status ENUM('pending','confirmed','expired') NOT NULL DEFAULT 'pending',
        txid VARCHAR(128) NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_payment_amount (ltc_amount),
        KEY idx_payment_user (discord_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

// ─── Accès (grants) ─────────────────────────────────────────────────────────
export async function getGrant(discordId) {
    const rows = await query("SELECT * FROM access_grants WHERE discord_id = ?", [discordId]);
    return rows[0] || null;
}

export async function extendGrant(discordId, days) {
    await query(
        `INSERT INTO access_grants (discord_id, expires_at)
             VALUES (?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY))
         ON DUPLICATE KEY UPDATE
             expires_at = DATE_ADD(GREATEST(expires_at, UTC_TIMESTAMP()), INTERVAL ? DAY)`,
        [discordId, days, days]
    );
}

/**
 * requireStaff l'appelle : owner toujours OK ; sans rôle → non ; avec rôle :
 * s'il existe un grant expiré → refusé (il doit rajouter du temps), sinon OK
 * (membres "legacy" sans grant = accès permanent).
 */
export async function hasValidAccess(user) {
    if (!user) return false;
    if (user.owner) return true;
    if (!user.staff) return false;
    const g = await getGrant(user.id);
    if (!g) return true;
    return new Date(g.expires_at) > new Date();
}

// ─── Factures ───────────────────────────────────────────────────────────────
async function createInvoice(discordId, tierKey) {
    const tier = TIERS[tierKey];
    if (!tier) return null;
    const rate = await getLtcRate();
    for (let attempt = 0; attempt < 5; attempt++) {
        const offset = 100 + crypto.randomInt(9900);           // 100..9999 litoshi — rend le montant unique
        const amount = (Math.ceil((tier.eur / rate) * SAT) + offset) / SAT;
        const id = crypto.randomUUID();
        try {
            await query(
                `INSERT INTO web_payments (id, discord_id, tier_key, eur, ltc_amount, status, expires_at)
                 VALUES (?, ?, ?, ?, ?, 'pending', DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))`,
                [id, discordId, tierKey, tier.eur, amount, INVOICE_TTL_MIN]
            );
            return { id, tier, amount, rate };
        } catch (e) {
            if (/Duplicate/i.test(e.message)) continue;          // collision de montant unique → retry
            throw e;
        }
    }
    throw new Error("Impossible d'allouer un montant de paiement unique — réessaie.");
}

async function getActiveInvoice(discordId, tierKey) {
    const rows = await query(
        `SELECT * FROM web_payments WHERE discord_id = ? AND tier_key = ? AND status = 'pending'
             AND expires_at > UTC_TIMESTAMP() ORDER BY created_at DESC LIMIT 1`,
        [discordId, tierKey]
    );
    return rows[0] || null;
}

// ─── Explorers LTC ──────────────────────────────────────────────────────────
// Normalise en [{ txid, conf, outs: [{ addr, value }], time }]
async function fetchIncomingTxs() {
    // 1) litecoinspace.org (API type mempool.space)
    try {
        const r = await fetch(`https://litecoinspace.org/api/address/${LTC_ADDR}/txs`, { signal: AbortSignal.timeout(9000) });
        if (r.ok) {
            const txs = await r.json();
            return (Array.isArray(txs) ? txs : []).map(tx => ({
                txid: tx.txid,
                conf: tx.status?.confirmed ? 1 : 0,
                time: tx.status?.block_time || 0,
                outs: (tx.vout || []).map(o => ({ addr: o.scriptpubkey_address, value: (o.value || 0) / SAT })),
            }));
        }
    } catch { /* fallback */ }
    // 2) BlockCypher
    const r = await fetch(`https://api.blockcypher.com/v1/ltc/main/addrs/${LTC_ADDR}/full?limit=50`, { signal: AbortSignal.timeout(9000) });
    if (!r.ok) throw new Error("Explorers LTC injoignables — réessaie dans un instant.");
    const j = await r.json();
    return (j.txs || []).map(tx => ({
        txid: tx.hash,
        conf: tx.confirmations || 0,
        time: new Date(tx.received || 0).getTime() / 1000,
        outs: (tx.outputs || []).map(o => ({ addr: (o.addresses || [])[0], value: (o.value || 0) / SAT })),
    }));
}

async function findPaymentForInvoice(inv) {
    const txs = await fetchIncomingTxs();
    txs.sort((a, b) => b.time - a.time);
    for (const tx of txs) {
        for (const out of tx.outs) {
            if (out.addr !== LTC_ADDR) continue;
            if (Math.abs(out.value - inv.ltc_amount) > MATCH_TOLERANCE) continue;
            const used = await query("SELECT id FROM web_payments WHERE txid = ? AND id <> ?", [tx.txid, inv.id]);
            if (used.length) return { reused: true, txid: tx.txid };
            return { txid: tx.txid, conf: tx.conf, value: out.value };
        }
    }
    return null;
}

// ─── Attribution de l'accès ─────────────────────────────────────────────────
async function applyRole(client, discordId) {
    const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) return false;
    try {
        const m = await guild.members.fetch(discordId);
        if (!m) return false;
        if (!m.roles.cache.has(CONFIG.ACCESS_ROLE_ID)) await m.roles.add(CONFIG.ACCESS_ROLE_ID);
        return true;
    } catch { return false; }
}

/**
 * Toutes les minutes : expire les vieilles factures, retire le rôle des
 * grants expirés, et ré-applique le rôle aux membres avec un grant valide
 * (rejoint après paiement, perte de rôle, etc.).
 */
export function startAccessSweeper(client) {
    setInterval(async () => {
        try {
            await query("UPDATE web_payments SET status='expired' WHERE status='pending' AND expires_at < UTC_TIMESTAMP()");

            const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
            if (!guild) return;

            const expired = await query("SELECT discord_id FROM access_grants WHERE expires_at < UTC_TIMESTAMP()");
            for (const row of expired) {
                try {
                    const m = await guild.members.fetch(row.discord_id);
                    if (m && m.roles.cache.has(CONFIG.ACCESS_ROLE_ID) && !m.roles.cache.has(CONFIG.OWNER_ROLE_ID)) {
                        await m.roles.remove(CONFIG.ACCESS_ROLE_ID);
                        console.log(`⏳ Accès expiré : rôle retiré pour ${row.discord_id}`);
                    }
                } catch { /* membre parti du serveur */ }
            }

            const valid = await query("SELECT discord_id FROM access_grants WHERE expires_at >= UTC_TIMESTAMP()");
            for (const row of valid) await applyRole(client, row.discord_id);
        } catch (e) {
            console.error("❌ [payments] sweeper error:", e.message);
        }
    }, 60_000);
}

export async function initPayments() {
    await initSchema();
    await refreshRate();
    setInterval(() => refreshRate().catch(() => {}), 60_000);
}

// ─── Pages ──────────────────────────────────────────────────────────────────
function payPage(title, body) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Access Panel</title>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet">
<style>
:root{color-scheme:dark}*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b0d12;color:#e7e9ee;font-family:"IBM Plex Sans",sans-serif;padding:20px}
.card{background:#12151c;border:1px solid #242836;border-radius:14px;padding:32px 36px;max-width:560px;width:100%;text-align:center}
h1{font-size:1.35rem;margin:0 0 6px;font-weight:600}
.sub{color:#8991a3;font-size:.9rem;margin:0 0 20px}
.plans{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:18px 0}
.plan{display:block;background:#171b24;border:1px solid #2a3040;border-radius:10px;padding:18px 10px;text-decoration:none;color:#e7e9ee;transition:.15s}
.plan:hover{border-color:#6c8cff;transform:translateY(-2px)}
.plan .l{font-weight:600;font-size:1.05rem}
.plan .p{color:#6c8cff;font-weight:700;font-size:1.2rem;margin-top:6px}
.btn{display:inline-block;margin-top:14px;padding:12px 34px;border-radius:8px;background:#00e676;color:#03140a;text-decoration:none;font-weight:700;font-size:1.05rem;box-shadow:0 0 22px #00e67655;border:none;cursor:pointer}
.btn:hover{filter:brightness(1.1)}
.addr{font-family:"IBM Plex Mono",monospace;font-size:.78rem;background:#0b0d12;border:1px solid #2a3040;border-radius:8px;padding:10px;word-break:break-all;margin:12px 0}
.amt{font-family:"IBM Plex Mono",monospace;font-size:1.5rem;font-weight:600;color:#00e676;margin:8px 0}
.copy{background:#232a3a;border:1px solid #2a3040;color:#e7e9ee;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:.85rem}
.copy:hover{border-color:#6c8cff}
.status{margin-top:16px;color:#8991a3;font-size:.9rem}
.spin{display:inline-block;width:14px;height:14px;border:2px solid #6c8cff;border-top-color:transparent;border-radius:50%;animation:s 1s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes s{to{transform:rotate(360deg)}}
a{color:#6c8cff}.muted{color:#8991a3;font-size:.85rem}
.qr{background:#fff;padding:10px;border-radius:12px;display:inline-block;margin-top:8px}
.method{display:flex;align-items:center;gap:14px;background:#171b24;border:2px solid #00e67655;border-radius:10px;padding:16px;text-align:left;text-decoration:none;color:#e7e9ee}
.method img{width:34px;height:34px}
.method .n{font-weight:700}.method .d{color:#8991a9;font-size:.85rem}
.note{background:#1a1408;border:1px solid #4a3a10;color:#e8c56b;border-radius:8px;padding:10px 12px;font-size:.85rem;margin-top:14px;text-align:left}
</style></head><body><div class="card"><h1>${esc(title)}</h1>${body}</div></body></html>`;
}

// ─── Router ─────────────────────────────────────────────────────────────────
export function createPayRouter(client) {
    const r = express.Router();
    const login = (req, res, next) => req.session.user ? next() : res.redirect("/login");
    const me = (req) => req.session.user;

    // Étape 1 — choix de la durée
    r.get("/buy", login, async (req, res) => {
        const grant = await getGrant(me(req).id);
        const expiry = grant && new Date(grant.expires_at) > new Date()
            ? `<p class="sub">Your access is valid until <strong>${esc(new Date(grant.expires_at).toUTCString())}</strong> — extending stacks time on top of it.</p>` : "";
        res.send(payPage("Choose your access time", `
            <p class="sub">Logged in as <strong>${esc(me(req).username)}</strong></p>${expiry}
            <div class="plans">
                ${Object.entries(TIERS).map(([k, t]) =>
                    `<a class="plan" href="/pay?plan=${k}"><span class="l">${t.label}</span><div class="p">${t.eur.toFixed(2)} €</div></a>`).join("")}
            </div>
            <a class="muted" href="/">← Back to panel</a>`));
    });

    // Étape 2 — méthode de paiement (LTC uniquement)
    r.get("/pay", login, (req, res) => {
        const tier = TIERS[req.query.plan];
        if (!tier) return res.redirect("/buy");
        req.session.payPlan = req.query.plan;
        res.send(payPage("Payment method", `
            <p class="sub"><strong>${tier.label}</strong> — ${tier.eur.toFixed(2)} €</p>
            <a class="method" href="/pay/checkout?plan=${req.query.plan}">
                <img src="https://cdn.jsdelivr.net/gh/atomiclabs/cryptocurrency-icons@1a63530be6e374711a8554f31b17e4cb92c25fa6/svg/color/ltc.svg" alt="LTC">
                <span><span class="n">Litecoin (LTC)</span><br><span class="d">On-chain payment — 1 network confirmation required</span></span>
            </a>
            <p class="muted" style="margin-top:16px">More payment methods coming soon.</p>
            <a class="muted" href="/buy">← Change plan</a>`));
    });

    // Étape 3 — facture : adresse + montant LTC + QR
    r.get("/pay/checkout", login, async (req, res) => {
        const tierKey = req.query.plan || req.session.payPlan;
        const tier = TIERS[tierKey];
        if (!tier) return res.redirect("/buy");
        try {
            let inv = await getActiveInvoice(me(req).id, tierKey);
            if (!inv) {
                const created = await createInvoice(me(req).id, tierKey);
                inv = { id: created.id, ltc_amount: created.amount, expires_at: new Date(Date.now() + INVOICE_TTL_MIN * 60000) };
            }
            const qr = await QRCode.toDataURL(`litecoin:${LTC_ADDR}?amount=${inv.ltc_amount}`, { width: 240, margin: 1 });
            res.send(payPage("Pay with Litecoin", `
                <p class="sub"><strong>${tier.label}</strong> — ${tier.eur.toFixed(2)} € · Invoice <span class="muted">#${inv.id.slice(0, 8)}</span></p>
                <div class="qr"><img src="${qr}" width="220" height="220" alt="LTC QR"></div>
                <div class="amt">${Number(inv.ltc_amount).toFixed(8)} LTC</div>
                <p class="muted">≈ ${tier.eur.toFixed(2)} € at the live LTC/EUR rate</p>
                <div class="addr" id="addr">${LTC_ADDR}</div>
                <button class="copy" onclick="navigator.clipboard.writeText('${LTC_ADDR}');this.textContent='Copied!'">Copy address</button>
                <button class="copy" onclick="navigator.clipboard.writeText('${Number(inv.ltc_amount).toFixed(8)}');this.textContent='Copied!'">Copy amount</button>
                <div class="status" id="st"><span class="spin"></span>Waiting for your payment… <span id="cd"></span></div>
                <div class="note">Send <strong>exactly</strong> this amount (the unique decimal identifies your payment automatically). Your access is activated after 1 network confirmation (~2.5 min). This invoice expires in ${INVOICE_TTL_MIN} min.</div>
                <script>
                    const ID = ${JSON.stringify(inv.id)}, EXP = ${JSON.stringify(inv.expires_at)};
                    setInterval(() => {
                        const s = Math.max(0, Math.floor((new Date(EXP) - Date.now()) / 1000));
                        document.getElementById('cd').textContent = Math.floor(s / 60) + 'm ' + (s % 60) + 's';
                    }, 1000);
                    async function poll() {
                        try {
                            const j = await (await fetch('/api/pay/status/' + ID)).json();
                            const st = document.getElementById('st');
                            if (j.status === 'confirmed') { window.location.href = '/pay/success'; return; }
                            if (j.status === 'expired')   { st.innerHTML = '⏰ Invoice expired — <a href="/buy">start a new one</a>'; return; }
                            if (j.status === 'reused')    { st.innerHTML = '⚠️ This transaction was already used.'; return; }
                            if (j.status === 'detected')  st.innerHTML = '<span class="spin"></span>Payment detected — waiting for 1 network confirmation…';
                        } catch (e) { /* explorer hiccup — retry */ }
                        setTimeout(poll, 10000);
                    }
                    poll();
                </script>`));
        } catch (e) {
            res.status(500).send(payPage("Payment error", `<p class="sub">${esc(e.message)}</p><a class="btn" href="/buy">Back</a>`));
        }
    });

    // Vérification on-chain (polling depuis la page de paiement)
    r.get("/api/pay/status/:id", login, async (req, res) => {
        try {
            const rows = await query("SELECT * FROM web_payments WHERE id = ?", [req.params.id]);
            const inv = rows[0];
            if (!inv || inv.discord_id !== me(req).id) return res.status(404).json({ status: "not_found" });
            if (inv.status === "confirmed") return res.json({ status: "confirmed" });
            if (new Date(inv.expires_at) < new Date()) {
                await query("UPDATE web_payments SET status='expired' WHERE id=? AND status='pending'", [inv.id]);
                return res.json({ status: "expired" });
            }
            const found = await findPaymentForInvoice(inv);
            if (!found) return res.json({ status: "waiting" });
            if (found.reused) return res.json({ status: "reused" });
            if (found.conf < REQUIRED_CONFS) return res.json({ status: "detected", conf: found.conf });
            const upd = await query("UPDATE web_payments SET status='confirmed', txid=? WHERE id=? AND status='pending'", [found.txid, inv.id]);
            if (upd.affectedRows > 0) {
                const tier = TIERS[inv.tier_key];
                await extendGrant(inv.discord_id, tier.days);
                await applyRole(client, inv.discord_id);
                console.log(`💰 Paiement confirmé : ${me(req).username} (${inv.discord_id}) — ${tier.label}, txid ${found.txid}`);
            }
            return res.json({ status: "confirmed" });
        } catch (e) {
            console.error("❌ [payments] status error:", e.message);
            res.status(500).json({ status: "error" });
        }
    });

    // Étape 5 — rôle + auto-join Discord + reload du panel
    r.get("/pay/success", login, async (req, res) => {
        const user = me(req);
        const rows = await query("SELECT * FROM web_payments WHERE discord_id=? AND status='confirmed' ORDER BY created_at DESC LIMIT 1", [user.id]);
        if (!rows.length) return res.redirect("/buy");
        const tier = TIERS[rows[0].tier_key];
        await extendGrant(user.id, 0); // no-op garantissant l'existence du grant
        req.session.user.staff = true;
        req.session.user.member = true;

        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        let member = null;
        try { member = guild ? await guild.members.fetch(user.id) : null; } catch { /* pas sur le serveur */ }

        if (!member && user.accessToken && guild) {
            // Le bot fait rejoindre le serveur automatiquement (scope guilds.join)
            try {
                const jr = await fetch(`https://discord.com/api/v10/guilds/${CONFIG.GUILD_ID}/members/${user.id}`, {
                    method: "PUT",
                    headers: { Authorization: `Bot ${CONFIG.TOKEN}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ access_token: user.accessToken }),
                    signal: AbortSignal.timeout(10000),
                });
                if (jr.ok || jr.status === 204) {
                    await new Promise(s => setTimeout(s, 1500));
                    try { member = await guild.members.fetch(user.id); } catch { /* retry laissé au sweeper */ }
                }
            } catch { /* fallback page d'invite */ }
        }

        if (!member) {
            return res.send(payPage("One last step — join the Discord", `
                <p class="sub">Your payment is confirmed (<strong>${tier.label}</strong>) but you're not on the Discord server yet. Join it so the bot can give you the Access role.</p>
                <a class="btn" href="${esc(INVITE_URL)}">Join the Discord server</a>
                <p class="muted" style="margin-top:14px">Once you're in, <a href="/pay/success">click here</a> — your access activates automatically.</p>`));
        }

        if (!member.roles.cache.has(CONFIG.ACCESS_ROLE_ID)) await member.roles.add(CONFIG.ACCESS_ROLE_ID).catch(() => {});
        const grant = await getGrant(user.id);
        const until = grant ? new Date(grant.expires_at).toUTCString() : "";
        res.send(payPage("Payment confirmed ✔", `
            <p class="sub">Your <strong>${tier.label}</strong> access is active${until ? ` until <strong>${esc(until)}</strong>` : ""}. Redirecting to the panel…</p>
            <script>setTimeout(() => location.href = "/", 2000);</script>
            <a class="btn" href="/">Open the panel</a>`));
    });

    return r;
}