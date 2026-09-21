/**
 * web/broadcast.js — push live queue updates to every connected browser
 *
 * Imported from BOTH sides that can change a request's state — the Discord
 * button handler (buttons.js) and the web panel's own action routes
 * (web/actions.js) — so whichever side acts, every open dashboard tab
 * updates immediately. This is the other half of "no conflict": the
 * database is the single source of truth, and this is how the web side
 * finds out the truth changed without polling for it.
 *
 * Safe to call even if the web panel isn't running (WEB_ENABLED=0, or it
 * hasn't finished starting yet) — getIO() returns null and every function
 * here just no-ops.
 */

import { getIO } from "./server.js";
import { getOperatorGroup } from "../config.js";

/** Shape sent to the browser — trims internal-only columns, adds the operator "group" the UI colors by. */
function serialize(row) {
    if (!row) return null;
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

export function broadcastNewRequest(row) {
    const io = getIO();
    if (!io || !row) return;
    io.emit("request:new", serialize(row));
}

/** `extra` lets a caller attach fields the DB row doesn't have yet (e.g. right after an action, before a re-read). */
export function broadcastRequestUpdate(row, extra = {}) {
    const io = getIO();
    if (!io || !row) return;
    io.emit("request:update", { ...serialize(row), ...extra });
}

export function broadcastRequestRemoved(phone) {
    const io = getIO();
    if (!io) return;
    io.emit("request:remove", { phone });
}
