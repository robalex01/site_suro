import { neon } from "@neondatabase/serverless";
import { checkBannedIP } from "./middleware.js";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") return res.status(405).json({ success: false });

  try {
    const blocked = await checkBannedIP(req, res);
    if (blocked) return blocked;

    const sql = neon(process.env.DATABASE_URL);
    const { type } = req.query;

    // ─── GLOBAL STATS ───
    if (type === "global" || !type) {
      const total = await sql`SELECT COUNT(*) as count FROM snap_requests`;
      const pending = await sql`SELECT COUNT(*) as count FROM snap_requests WHERE status = ${"pending"}`;
      const processing = await sql`SELECT COUNT(*) as count FROM snap_requests WHERE status = ${"processing"}`;
      const waiting = await sql`SELECT COUNT(*) as count FROM snap_requests WHERE status = ${"waiting_code"}`;
      const submitted = await sql`SELECT COUNT(*) as count FROM snap_requests WHERE status = ${"code_submitted"}`;
      const completed = await sql`SELECT COUNT(*) as count FROM snap_requests WHERE status = ${"completed"}`;
      const wrong = await sql`SELECT COUNT(*) as count FROM snap_requests WHERE status = ${"wrong_number"}`;
      const retry = await sql`SELECT COUNT(*) as count FROM snap_requests WHERE status = ${"retry_code"}`;
      const banned = await sql`SELECT COUNT(*) as count FROM banned_ips`;

      return res.status(200).json({
        success: true,
        data: {
          total: total[0].count,
          pending: pending[0].count,
          processing: processing[0].count,
          waiting: waiting[0].count,
          submitted: submitted[0].count,
          completed: completed[0].count,
          wrong: wrong[0].count,
          retry: retry[0].count,
          banned: banned[0].count
        }
      });
    }

    // ─── TODAY STATS ───
    if (type === "today") {
      const requests = await sql`SELECT COUNT(*) as count FROM snap_requests WHERE created_at >= CURRENT_DATE`;
      const completed = await sql`SELECT COUNT(*) as count FROM snap_requests WHERE status = ${"completed"} AND created_at >= CURRENT_DATE`;
      return res.status(200).json({
        success: true,
        data: { requests: requests[0].count, completed: completed[0].count }
      });
    }

    // ─── OPERATOR STATS ───
    if (type === "operators") {
      const rows = await sql`
        SELECT operator, COUNT(*) as count 
        FROM snap_requests 
        GROUP BY operator 
        ORDER BY count DESC
      `;
      return res.status(200).json({ success: true, data: rows });
    }

    // ─── HOURLY STATS ───
    if (type === "hourly") {
      const rows = await sql`
        SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as count
        FROM snap_requests
        WHERE created_at >= NOW() - INTERVAL '24 hours'
        GROUP BY hour
        ORDER BY hour
      `;
      return res.status(200).json({ success: true, data: rows });
    }

    // ─── STAFF LEADERBOARD ───
    if (type === "leaderboard") {
      const limit = parseInt(req.query.limit) || 10;
      const rows = await sql`
        SELECT 
          details->>'staff_tag' as staff,
          COUNT(*) as validations
        FROM snap_logs 
        WHERE action = ${"true_code"} AND details->>'staff_tag' IS NOT NULL
        GROUP BY details->>'staff_tag'
        ORDER BY validations DESC
        LIMIT ${limit}
      `;
      return res.status(200).json({ success: true, data: rows });
    }

    return res.status(400).json({ success: false, message: "Invalid stats type" });
  } catch (e) {
    console.error("Stats API error:", e);
    return res.status(500).json({ success: false, message: e.message });
  }
}
