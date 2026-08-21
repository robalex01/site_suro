import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') return res.status(405).json({ success: false });

  try {
    const { phone } = req.query;
    if (!phone) return res.status(400).json({ success: false });

    const sql = neon(process.env.DATABASE_URL);
    const result = await sql`SELECT status, code_length FROM snap_requests WHERE phone = ${phone} LIMIT 1`;

    if (result.length === 0) return res.status(404).json({ success: false, message: 'Not found' });

    return res.status(200).json({
      success: true,
      status: result[0].status,
      code_length: result[0].code_length
    });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}