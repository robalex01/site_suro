import { sql } from './_db.js';

export function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first && first !== 'unknown') return first;
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

/**
 * "This IP is not banned" is remembered for a short while, per serverless
 * instance. Every API call starts with a ban check, and visitors poll
 * /api/status every 3 s — without this, half of all database connections
 * were spent re-asking the same question. Only NEGATIVE answers are cached:
 * a banned IP is always re-checked, so a ban takes effect within CLEAN_TTL_MS
 * and an un-ban is immediate.
 */
const CLEAN_TTL_MS = 20_000;
const cleanIps = new Map(); // ip -> timestamp of the last "not banned" answer

function isKnownClean(ip) {
  const at = cleanIps.get(ip);
  return at !== undefined && Date.now() - at < CLEAN_TTL_MS;
}

function markClean(ip) {
  if (cleanIps.size > 500) {
    const now = Date.now();
    for (const [k, at] of cleanIps) if (now - at >= CLEAN_TTL_MS) cleanIps.delete(k);
    if (cleanIps.size > 500) cleanIps.clear();
  }
  cleanIps.set(ip, Date.now());
}

/** true/false. Throws if the database can't be reached (callers decide what to do). */
export async function isIpBanned(ip) {
  if (isKnownClean(ip)) return false;
  const banned = await sql`SELECT 1 FROM banned_ips WHERE ip_address = ${ip} LIMIT 1`;
  if (banned.length > 0) return true;
  markClean(ip);
  return false;
}

export async function checkBannedIP(req, res) {
  const ip = getClientIP(req);
  if (!ip || ip === 'unknown' || ip === 'null' || ip === 'undefined' || ip === '::1' || ip === '127.0.0.1') {
    return null;
  }
  try {
    if (await isIpBanned(ip)) {
      console.log('BLOCKED banned IP: ' + ip);
      return res.status(403).json({ success: false, message: 'Access denied: your IP has been banned.' });
    }
  } catch (e) { console.error('Ban check error:', e.message); } // fail open: a DB hiccup must not lock everyone out
  return null;
}

export function withBanCheck(handler) {
  return async (req, res) => {
    const blocked = await checkBannedIP(req, res);
    if (blocked) return blocked;
    return handler(req, res);
  };
}
