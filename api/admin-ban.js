import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  try {
    const { pin, ip } = req.body;
    if (!pin || pin !== process.env.STAFF_PIN) {
      return res.status(401).json({ success: false, message: 'Code incorrect' });
    }
    if (!ip) return res.status(400).json({ success: false, message: 'IP manquante' });

    const sql = neon(process.env.DATABASE_URL);
    await sql`
      INSERT INTO banned_ips (ip_address, reason, banned_by)
      VALUES (${ip}, 'Panel admin', 'Staff')
      ON CONFLICT (ip_address) DO NOTHING
    `;

    return res.status(200).json({ success: true, message: `IP ${ip} bannie` });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}