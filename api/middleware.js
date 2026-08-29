import { neon } from '@neondatabase/serverless';

export function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first && first !== 'unknown') return first;
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

export async function checkBannedIP(req, res) {
  const ip = getClientIP(req);
  if (!ip || ip === 'unknown' || ip === 'null' || ip === 'undefined' || ip === '::1' || ip === '127.0.0.1') {
    return null;
  }
  try {
    if (!process.env.DATABASE_URL) { console.error('DATABASE_URL not configured'); return null; }
    const sql = neon(process.env.DATABASE_URL);
    const banned = await sql`SELECT 1 FROM banned_ips WHERE ip_address = ${ip} LIMIT 1`;
    if (banned.length > 0) {
      console.log('BLOCKED banned IP: ' + ip);
      return res.status(403).json({ success: false, message: 'Access denied: your IP has been banned.' });
    }
  } catch (e) { console.error('Ban check error:', e.message); }
  return null;
}

export function withBanCheck(handler) {
  return async (req, res) => {
    const blocked = await checkBannedIP(req, res);
    if (blocked) return blocked;
    return handler(req, res);
  };
}
