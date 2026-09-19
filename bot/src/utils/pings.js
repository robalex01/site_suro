/**
 * pings.js — per-staff-member ping routing
 *
 * THE PROBLEM THIS SOLVES
 * A role mention (`<@&123>`) is all-or-nothing: Discord pings every member
 * of that role and gives no way to exclude one person. So "let each staff
 * member decide whether they get pinged" cannot be built on role mentions
 * at all — the only way to honour an individual opt-out is to stop
 * mentioning the role and mention the *people* instead, minus whoever
 * turned pings off.
 *
 * That's what this does: resolve the members of the access role, drop
 * everyone who set receive_pings = false, and mention the rest by user ID.
 *
 * REQUIREMENT — SERVER MEMBERS INTENT
 * Resolving a role's members needs the privileged GuildMembers intent
 * (enabled in bot.js AND ticked in the Discord Developer Portal under
 * Bot -> Privileged Gateway Intents -> Server Members Intent). Without it
 * the member list comes back empty and there is no way to know who to
 * mention.
 *
 * FALLBACK — NEVER BREAK THE EXISTING BEHAVIOUR
 * If the intent is off, the fetch fails, or the resulting mention list is
 * too long for one message, this falls straight back to the plain role
 * mention the bot used before. Staff still get pinged exactly as they do
 * today; the only thing lost is the individual opt-out. A degraded ping is
 * always better than a request nobody sees.
 */

import { CONFIG } from "../config.js";
import { getPingOptOutIds } from "../database.js";

// Above this many individual mentions, fall back to the role mention:
// past roughly this point the `content` line becomes an unreadable wall of
// pings and starts crowding Discord's 2000-character limit.
const MAX_INDIVIDUAL_MENTIONS = 35;

const MEMBER_CACHE_TTL_MS   = 60_000;
const OPT_OUT_CACHE_TTL_MS  = 30_000;

let memberCache  = { ids: null, expiresAt: 0 };
let optOutCache  = { ids: null, expiresAt: 0 };

/** The old behaviour: ping the whole access role. Used as the fallback everywhere below. */
function roleMentionPayload() {
    return {
        content: CONFIG.PING_MESSAGE || `<@&${CONFIG.ACCESS_ROLE_ID}>`,
        allowedMentions: { roles: [CONFIG.ACCESS_ROLE_ID] },
    };
}

async function fetchAccessRoleMemberIds(guild) {
    if (memberCache.ids && memberCache.expiresAt > Date.now()) return memberCache.ids;

    // Populates the member cache from the gateway — a no-op without the
    // GuildMembers intent, which is precisely the case we detect below.
    await guild.members.fetch();
    const role = await guild.roles.fetch(CONFIG.ACCESS_ROLE_ID);
    if (!role) return null;

    const ids = [...role.members.keys()];
    memberCache = { ids, expiresAt: Date.now() + MEMBER_CACHE_TTL_MS };
    return ids;
}

async function fetchOptOutIds() {
    if (optOutCache.ids && optOutCache.expiresAt > Date.now()) return optOutCache.ids;
    const ids = await getPingOptOutIds();
    optOutCache = { ids, expiresAt: Date.now() + OPT_OUT_CACHE_TTL_MS };
    return ids;
}

/** Called when someone toggles their ping setting, so the change takes effect on the next request rather than up to 30s later. */
export function invalidatePingCache() {
    optOutCache = { ids: null, expiresAt: 0 };
}

/**
 * Builds the `content` + `allowedMentions` for a new-request message,
 * pinging only the staff who actually want to be pinged.
 *
 * A custom CONFIG.PING_MESSAGE (e.g. "@here") is treated as a deliberate
 * global override and is left exactly as-is — someone who explicitly
 * configured a raw ping string means it literally, and silently rewriting
 * it into a list of user mentions would be the opposite of what they asked
 * for.
 *
 * @returns {Promise<{content: string, allowedMentions: object}>}
 */
export async function buildRequestPing(guild) {
    if (CONFIG.PING_MESSAGE) return roleMentionPayload();
    if (!guild)              return roleMentionPayload();

    try {
        const memberIds = await fetchAccessRoleMemberIds(guild);

        if (!memberIds || memberIds.length === 0) {
            console.warn(
                "⚠️  Could not resolve members of the access role — falling back to a plain role mention. " +
                "Individual ping preferences will NOT be honoured until the Server Members Intent is enabled " +
                "in the Discord Developer Portal (Bot -> Privileged Gateway Intents)."
            );
            return roleMentionPayload();
        }

        const optedOut = new Set(await fetchOptOutIds());
        const toPing   = memberIds.filter(id => !optedOut.has(id));

        // Everyone with the role has muted pings. Still send the message —
        // the request must appear in the channel regardless — just silently.
        if (toPing.length === 0) {
            return { content: "", allowedMentions: { parse: [] } };
        }

        if (toPing.length > MAX_INDIVIDUAL_MENTIONS) {
            console.warn(
                `⚠️  ${toPing.length} staff to ping individually exceeds the ${MAX_INDIVIDUAL_MENTIONS} limit — ` +
                "using a role mention for this request instead (individual opt-outs ignored this time)."
            );
            return roleMentionPayload();
        }

        return {
            content: toPing.map(id => `<@${id}>`).join(" "),
            allowedMentions: { users: toPing },
        };
    } catch (e) {
        // Any failure at all (missing intent, rate limit, DB blip) must not
        // stop a request from being delivered — degrade to the old behaviour.
        console.warn("⚠️  Per-user ping resolution failed, falling back to role mention:", e.message || e);
        return roleMentionPayload();
    }
}
