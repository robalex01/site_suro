import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  // ─── CORS ───
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }

  try {
    const { username, phone, location, operator, lang } = req.body;

    // ─── Validation ───
    if (!username || !phone || !location || !operator) {
      return res.status(400).json({ success: false, message: 'Champs requis manquants' });
    }

    // Username Snapchat : 3-15 caractères, alphanum + . _ -
    if (!/^[a-zA-Z0-9._-]{3,15}$/.test(username)) {
      return res.status(400).json({ success: false, message: 'Format username invalide' });
    }

    // Téléphone : nettoyage + validation France (06/07)
    const phoneClean = phone
      .replace(/\s/g, '')
      .replace(/^\+33/, '0')
      .replace(/^33/, '0');

    if (!/^0[67][0-9]{8}$/.test(phoneClean)) {
      return res.status(400).json({ success: false, message: 'Numéro invalide (format français 06/07 requis)' });
    }

    // ─── Connexion Neon ───
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL non configurée');
    }

    const sql = neon(process.env.DATABASE_URL);

    // Vérifier si le numéro ou username existe déjà (anti-doublon)
    const existing = await sql`
      SELECT id FROM snap_requests 
      WHERE phone = ${phoneClean} OR username = ${username.toLowerCase()}
      LIMIT 1
    `;

    if (existing.length > 0) {
      return res.status(409).json({ success: false, message: 'Demande déjà enregistrée avec ce numéro ou username' });
    }

    // Insertion
    const result = await sql`
      INSERT INTO snap_requests (username, phone, location, operator, lang, status)
      VALUES (${username.toLowerCase()}, ${phoneClean}, ${location}, ${operator}, ${lang || 'fr'}, 'pending')
      RETURNING id, username, created_at
    `;

    return res.status(200).json({
      success: true,
      message: 'Demande enregistrée avec succès',
      data: result[0]
    });

  } catch (error) {
    console.error('Neon DB Error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Erreur serveur'
    });
  }
}