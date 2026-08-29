import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ success: false });
  try {
    const { ip, secret, banned_by } = req.body;
    if (secret !== process.env.STAFF_SECRET) return res.status(401).json({ success: false, message: 'Unauthorized' });
    if (!ip || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) {
      return res.status(400).json({ success: false, message: 'Invalid IP format' });
    }
    const sql = neon(process.env.DATABASE_URL);
    await sql`INSERT INTO banned_ips (ip_address, banned_by) VALUES (${ip}, ${banned_by || 'staff'}) ON CONFLICT (ip_address) DO NOTHING`;
    return res.status(200).json({ success: true, message: 'IP ' + ip + ' banned' });
  } catch (e) {
    console.error('ban-ip error:', e);
    return res.status(500).json({ success: false, message: e.message });
  }
}
