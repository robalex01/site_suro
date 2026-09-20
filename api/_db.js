/**
 * api/_db.js — shared MySQL / MariaDB access for every API route.
 *
 * (The leading underscore makes Vercel ignore this file as a route; it is
 * only ever imported.)
 *
 * Connection, from the Vercel environment variables:
 *   DATABASE_URL = mysql://user:password@host:3306/dbname
 *   — or —
 *   DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME     (wins over DATABASE_URL)
 *
 * ── WHY THERE IS NO CONNECTION POOL HERE (v3) ────────────────────────────────
 * The error  "User … already has more than 'max_user_connections' active
 * connections"  means the database account hit its cap on simultaneous
 * connections (25 here) and every connection ever opened by the website AND
 * the Discord bot counts against it.
 *
 * The old version kept a pool of up to 3 connections per serverless instance.
 * On Vercel an instance is frozen between requests, so its pooled connections
 * stay open on the DB server (MariaDB waits 8 HOURS by default before dropping
 * an idle one) while new instances open their own. They pile up until the cap
 * is hit and every request — including /api/status polled every 3 s by each
 * visitor — fails with a 500.
 *
 * Now every query opens its own short-lived connection and ALWAYS closes it
 * before returning, so nothing can linger on the server after a request.
 * Around that:
 *   - at most MAX_LOCAL_CONCURRENCY queries run at once per instance;
 *   - if the server says "too many connections" the query is retried a few
 *     times with a short jittered backoff instead of failing immediately;
 *   - each connection gets `wait_timeout = 20` as a safety net, so even if a
 *     close were ever lost the server drops it itself within seconds;
 *   - every connection is switched to UTC (SET time_zone = '+00:00') so that
 *     NOW() / CURRENT_TIMESTAMP defaults and the JS Dates read back agree.
 */

// Named import on purpose: Vercel compiles these files ESM -> CommonJS, and a default
// import of mysql2/promise only works when the compiler applies esModuleInterop.
import { createConnection } from 'mysql2/promise';

// ─── Connection options ──────────────────────────────────────────────────────

function safeDecode(s) {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * Tolerant mysql:// URL parser. The user info is everything before the LAST '@',
 * split at the first ':' — so the password may itself contain @ # / ? : and so on
 * (the WHATWG `new URL()` rejects or truncates those).
 */
function parseDbUrl(raw) {
  const s = String(raw || '')
    .trim()
    .replace(/^DATABASE_URL\s*=\s*/i, '')   // value pasted together with its key
    .replace(/^(["'])(.*)\1$/, '$2');       // surrounding quotes

  if (/^postgres(ql)?:/i.test(s)) {
    throw new Error('DATABASE_URL still points to Postgres (postgres://…). Replace it with mysql://user:password@host:3306/dbname');
  }
  const m = s.match(/^(?:mysql|mariadb):\/\/(.*)@([^@/?#]+)(\/[^?#]*)?(\?.*)?$/i);
  if (!m) {
    throw new Error(`DATABASE_URL is not valid (expected mysql://user:password@host:3306/dbname) — it starts with "${s.slice(0, 8)}" and is ${s.length} characters long`);
  }

  const [, userinfo, hostport, path = '', query = ''] = m;
  const colon = userinfo.indexOf(':');
  const hp    = hostport.match(/^(.*?)(?::(\d+))?$/);

  return {
    host:     hp[1],
    port:     hp[2] ? Number(hp[2]) : 3306,
    user:     safeDecode(colon < 0 ? userinfo : userinfo.slice(0, colon)),
    password: colon < 0 ? '' : safeDecode(userinfo.slice(colon + 1)),
    database: safeDecode(path.replace(/^\//, '')),
    ssl:      /[?&]ssl=(true|1)\b/i.test(query),
  };
}

function buildOptions() {
  const env = process.env;
  let base;

  if (env.DB_HOST) {
    // DB_HOST may be written "host" or "host:3306" — the port is split off either way.
    const rawHost = env.DB_HOST.trim();
    const hostPort = rawHost.match(/^(.*?):(\d+)$/);
    base = {
      host:     hostPort ? hostPort[1] : rawHost,
      port:     hostPort ? Number(hostPort[2]) : (parseInt(env.DB_PORT, 10) || 3306),
      user:     env.DB_USER,
      password: env.DB_PASSWORD || '',
      database: env.DB_NAME,
    };
  } else {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL not configured');
    const { ssl, ...parsed } = parseDbUrl(env.DATABASE_URL);
    base = parsed;
    if (ssl) base.ssl = { rejectUnauthorized: false };
  }

  return {
    ...base,
    charset:        'utf8mb4',
    connectTimeout: 8000,
    timezone:       'Z',
  };
}

let cachedOptions = null;
function getOptions() {
  if (!cachedOptions) cachedOptions = buildOptions();
  return cachedOptions;
}

// ─── Error classification ────────────────────────────────────────────────────

/** ER_USER_LIMIT_REACHED (1226) / ER_CON_COUNT_ERROR (1040): the server has no free connection slot right now. */
export function isBusyError(e) {
  if (e?.errno === 1226 || e?.errno === 1040) return true;
  return /ER_USER_LIMIT_REACHED|max_user_connections|ER_CON_COUNT_ERROR|Too many connections/i
    .test(`${e?.code || ''} ${e?.message || ''}`);
}

const TRANSIENT = /PROTOCOL_CONNECTION_LOST|ECONNRESET|EPIPE|ETIMEDOUT|ECONNREFUSED|EAI_AGAIN|closed state|Connection lost|Connect Timeout/i;

function isRetryable(e) {
  return isBusyError(e) || TRANSIENT.test(`${e?.code || ''} ${e?.message || ''}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Per-instance concurrency gate ───────────────────────────────────────────

const MAX_LOCAL_CONCURRENCY = 3;
let active = 0;
const waiters = [];

async function acquireSlot() {
  if (active < MAX_LOCAL_CONCURRENCY) { active++; return; }
  await new Promise(resolve => waiters.push(resolve)); // slot is handed over directly, `active` unchanged
}

function releaseSlot() {
  const next = waiters.shift();
  if (next) next(); else active--;
}

// ─── Query execution ─────────────────────────────────────────────────────────

async function closeConnection(conn) {
  try {
    await Promise.race([conn.end(), sleep(1000).then(() => { throw new Error('end timeout'); })]);
  } catch {
    try { conn.destroy(); } catch { /* already gone */ }
  }
}

async function runOnce(text, params) {
  await acquireSlot();
  let conn;
  try {
    conn = await createConnection(getOptions());
    // One round trip: UTC session + a short idle timeout as a safety net.
    await conn.query("SET time_zone = '+00:00', wait_timeout = 20");
    const [result] = await conn.query(text, params);
    return result;
  } finally {
    if (conn) await closeConnection(conn);
    releaseSlot();
  }
}

const MAX_ATTEMPTS = 5;

/**
 * query('SELECT ... WHERE a = ?', [x])
 * SELECT → array of rows. INSERT/UPDATE/DELETE → { affectedRows, insertId, ... }.
 *
 * Retries only connection-level failures (server busy, reset, timeout). A real
 * SQL error is thrown immediately. Every statement in this app is either a read
 * or an idempotent/guarded write, so retrying after a lost response is safe.
 */
export async function query(text, params = []) {
  let lastErr;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await runOnce(text, params);
    } catch (e) {
      lastErr = e;
      if (!isRetryable(e) || attempt === MAX_ATTEMPTS - 1) break;
      const base = isBusyError(e) ? 250 : 100;
      await sleep(base * (attempt + 1) + Math.random() * 150);
    }
  }
  throw lastErr;
}

/** Tagged template: sql`SELECT * FROM t WHERE a = ${x}` — values become ? placeholders. */
export function sql(strings, ...values) {
  return query(strings.join('?'), values);
}

// ─── Error responses ─────────────────────────────────────────────────────────

/**
 * Standard failure response for a route's catch block. The real error goes to
 * the server logs only — it used to be sent to the browser, which leaked the
 * database account name ("User u718de371_… already has more than…").
 * A saturated database is a 503 (clients treat it as "try again shortly"),
 * anything else a 500.
 */
export function fail(res, e, context = 'API') {
  console.error(`${context} error:`, e);
  if (isBusyError(e)) {
    res.setHeader('Retry-After', '2');
    return res.status(503).json({
      success: false,
      busy:    true,
      message: 'Service momentanément saturé, veuillez réessayer dans quelques secondes.',
    });
  }
  return res.status(500).json({ success: false, message: 'Erreur serveur' });
}
