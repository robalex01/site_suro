import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ success: false, message: 'Champs manquants' });

    const sql = neon(process.env.DATABASE_URL);
    const result = await sql`SELECT staff_code, status FROM snap_requests WHERE phone = ${phone} LIMIT 1`;

    if (result.length === 0) return res.status(404).json({ success: false, message: 'Demande non trouvée' });

    const row = result[0];
    if (row.status === 'completed') {
      return res.status(200).json({ success: true, message: 'Déjà validé' });
    }

    if (row.staff_code === code) {
      await sql`UPDATE snap_requests SET status = 'completed' WHERE phone = ${phone}`;

      // Notifier Discord que le code a été validé
      if (process.env.DISCORD_WEBHOOK_URL) {
        try {
          await fetch(process.env.DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: `✅ **Code validé** pour le numéro \`${phone}\` — Snapchat+ activé !`
            })
          });
        } catch (e) {}
      }

      return res.status(200).json({ success: true, message: 'Code validé' });
    } else {
      return res.status(400).json({ success: false, message: 'Code incorrect' });
    }
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}