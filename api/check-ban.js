import { neon } from '@neondatabase/serverless';
import { getClientIP } from './middleware.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') return res.status(405).json({ success: false });
  try {
    const ip = getClientIP(req);
    if (!ip || ip === 'unknown' || ip === 'null' || ip === 'undefined') {
      return res.status(200).json({ success: true, banned: false });
    }
    const sql = neon(process.env.DATABASE_URL);
    const banned = await sql`SELECT 1 FROM banned_ips WHERE ip_address = ${ip} LIMIT 1`;
    if (banned.length > 0) return res.status(200).json({ success: true, banned: true, ip });
    return res.status(200).json({ success: true, banned: false });
  } catch (e) {
    console.error('check-ban error:', e);
    return res.status(500).json({ success: false, message: e.message });
  }
}
