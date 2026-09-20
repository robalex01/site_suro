import { sql, query, fail } from "./_db.js";
import { checkBannedIP } from "./middleware.js";

// snap_logs.details is JSON keyed by Discord tag. JSON_UNQUOTE(JSON_EXTRACT(..))
// works on both MySQL and MariaDB (the ->> operator is MySQL-only).
const STAFF_TAG = "JSON_UNQUOTE(JSON_EXTRACT(details, '$.staff_tag'))";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "GET") return res.status(405).json({ success: false });

  try {
    const blocked = await checkBannedIP(req, res);
    if (blocked) return blocked;

    const { type } = req.query;

    // ─── GLOBAL STATS ───
    if (type === "global" || !type) {
      const [totals] = await sql`
        SELECT
          COUNT(*)                                              AS total,
          COUNT(CASE WHEN status = 'pending'        THEN 1 END) AS pending,
          COUNT(CASE WHEN status = 'processing'     THEN 1 END) AS processing,
          COUNT(CASE WHEN status = 'waiting_code'   THEN 1 END) AS waiting,
          COUNT(CASE WHEN status = 'code_submitted' THEN 1 END) AS submitted,
          COUNT(CASE WHEN status = 'completed'      THEN 1 END) AS completed,
          COUNT(CASE WHEN status = 'wrong_number'   THEN 1 END) AS wrong,
          COUNT(CASE WHEN status = 'retry_code'     THEN 1 END) AS retry
        FROM snap_requests
      `;
      const [banned] = await sql`SELECT COUNT(*) AS \`count\` FROM banned_ips`;

      return res.status(200).json({
        success: true,
        data: { ...totals, banned: banned.count }
      });
    }

    // ─── TODAY STATS ───
    if (type === "today") {
      const [row] = await sql`
        SELECT
          COUNT(*)                                         AS requests,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completed
        FROM snap_requests
        WHERE created_at >= CURDATE()
      `;
      return res.status(200).json({ success: true, data: row });
    }

    // ─── OPERATOR STATS ───
    if (type === "operators") {
      const rows = await sql`
        SELECT operator, COUNT(*) AS \`count\`
        FROM snap_requests
        GROUP BY operator
        ORDER BY \`count\` DESC
      `;
      return res.status(200).json({ success: true, data: rows });
    }

    // ─── HOURLY STATS ───
    if (type === "hourly") {
      const rows = await sql`
        SELECT EXTRACT(HOUR FROM created_at) AS \`hour\`, COUNT(*) AS \`count\`
        FROM snap_requests
        WHERE created_at >= NOW() - INTERVAL 24 HOUR
        GROUP BY EXTRACT(HOUR FROM created_at)
        ORDER BY \`hour\`
      `;
      return res.status(200).json({ success: true, data: rows });
    }

    // ─── STAFF LEADERBOARD ───
    if (type === "leaderboard") {
      const limit = Math.min(parseInt(req.query.limit) || 10, 100);
      const rows = await query(
        `SELECT ${STAFF_TAG} AS staff, COUNT(*) AS validations
         FROM snap_logs
         WHERE action = 'true_code' AND ${STAFF_TAG} IS NOT NULL
         GROUP BY ${STAFF_TAG}
         ORDER BY validations DESC
         LIMIT ?`,
        [limit]
      );
      return res.status(200).json({ success: true, data: rows });
    }

    return res.status(400).json({ success: false, message: "Invalid stats type" });
  } catch (e) {
    return fail(res, e, "stats");
  }
}
