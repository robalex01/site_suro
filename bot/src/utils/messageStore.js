/**
 * messageStore.js — phone -> original channel message lookup
 *
 * Mirrors claimStore.js's pattern (in-memory first, DB fallback, cached
 * back). Needed because the True/False Code buttons are sent to the
 * claimer's DM, not posted in the channel — so an interaction on them
 * cannot use `interaction.message` to reach the public request embed.
 * This lets any handler, DM or channel, look up "the channel message for
 * this phone number" and refresh it.
 */

import { setRequestMessage, getRequestMessage, deleteRequestMessage } from "../database.js";

/** phone -> { channelId, messageId } */
const cache = new Map();

/** Record where a request's public embed lives. Call once, right after the initial channel.send(). */
export function rememberMessage(phone, channelId, messageId) {
    cache.set(phone, { channelId, messageId });
    // Best-effort persistence — a failure here just means a restart mid-flight
    // won't be able to refresh the channel message, not a functional break.
    setRequestMessage(phone, channelId, messageId).catch(e =>
        console.warn("⚠️  Could not persist request message location:", e.message)
    );
}

/** Resolve where a request's public embed lives: in-memory first, DB fallback (covers a bot restart). */
export async function recallMessage(phone) {
    let loc = cache.get(phone);
    if (!loc) {
        const row = await getRequestMessage(phone);
        if (row) {
            loc = { channelId: row.channel_id, messageId: row.message_id };
            cache.set(phone, loc);
        }
    }
    return loc || null;
}

/** Drop the lookup once a request's lifecycle is over (validated, wrong number, banned). */
export function forgetMessage(phone) {
    cache.delete(phone);
    deleteRequestMessage(phone).catch(() => {});
}
