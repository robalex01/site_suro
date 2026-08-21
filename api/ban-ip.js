import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  try {
    const { ip, secret, reason, banned_by } = req.body;
    if (secret !== process.env.STAFF_SECRET) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    if (!ip) return res.status(400).json({ success: false, message: 'IP manquante' });

    const sql = neon(process.env.DATABASE_URL);
    await sql`
      INSERT INTO banned_ips (ip_address, reason, banned_by)
      VALUES (${ip}, ${reason || 'Staff ban'}, ${banned_by || 'Staff'})
      ON CONFLICT (ip_address) DO NOTHING
    `;

    return res.status(200).json({ success: true, message: `IP ${ip} bannie` });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}