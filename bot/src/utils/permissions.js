/**
 * permissions.js — role-based access control
 *
 * Two tiers:
 *  - OWNER (CONFIG.OWNER_ROLE_ID)  — full access, always. Bypasses the
 *    claimer-only lock on request buttons and can run every command.
 *  - STAFF (CONFIG.STAFF_ROLE_ID)  — required for every slash command and
 *    every request button. Without it, a member sees a "no permission"
 *    ephemeral reply instead of the action running.
 *
 * `member` here is a discord.js GuildMember. It is null for interactions
 * received in a DM (e.g. the True/False Code buttons, which are sent to
 * the claimer's DMs) — both helpers safely return false in that case via
 * optional chaining, they never throw. Callers that need to allow DM
 * interactions (see buttons.js) branch on `interaction.inGuild()` before
 * calling these rather than relying on a bypass here.
 */

import { CONFIG } from "../config.js";

export function isOwner(member) {
    return !!member?.roles?.cache?.has(CONFIG.OWNER_ROLE_ID);
}

export function isStaff(member) {
    return isOwner(member) || !!member?.roles?.cache?.has(CONFIG.STAFF_ROLE_ID);
}
