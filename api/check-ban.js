import { fail } from './_db.js';
import { getClientIP, isIpBanned } from './middleware.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') return res.status(405).json({ success: false });
  try {
    const ip = getClientIP(req);
    if (!ip || ip === 'unknown' || ip === 'null' || ip === 'undefined') {
      return res.status(200).json({ success: true, banned: false });
    }
    if (await isIpBanned(ip)) return res.status(200).json({ success: true, banned: true, ip });
    return res.status(200).json({ success: true, banned: false });
  } catch (e) {
    return fail(res, e, 'check-ban');
  }
}
