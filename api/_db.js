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
 * The URL is parsed by hand (see parseDbUrl) so a password containing @ # / ? :
 * works without URL-encoding it. DB_* is still the most foolproof option.
 *
 * Every connection is switched to UTC (SET time_zone = '+00:00') so that
 * NOW() / CURRENT_TIMESTAMP defaults, and the JS Dates read back, always agree
 * — the Discord bot does the same, so both sides of the shared database see
 * identical timestamps.
 */

// Named import on purpose: Vercel compiles these files ESM -> CommonJS, and a default
// import of mysql2/promise only works when the compiler applies esModuleInterop.
import { createPool } from 'mysql2/promise';

let pool = null;

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
    charset:               'utf8mb4',
    waitForConnections:    true,
    connectionLimit:       3,       // serverless: many instances, keep each one small
    queueLimit:            0,
    connectTimeout:        8000,
    enableKeepAlive:       true,
    keepAliveInitialDelay: 10000,
    timezone:              'Z',
  };
}

function getPool() {
  if (!pool) {
    pool = createPool(buildOptions());
    // Queued before any caller's query on that connection, so it always runs first.
    pool.pool.on('connection', (conn) => {
      conn.query("SET time_zone = '+00:00'", () => {});
    });
  }
  return pool;
}

// A pooled connection that sat idle while the function was frozen can be dead
// by the time it is reused — retry once on a fresh one.
const TRANSIENT = /PROTOCOL_CONNECTION_LOST|ECONNRESET|EPIPE|ETIMEDOUT|closed state|Connection lost/i;

/**
 * query('SELECT ... WHERE a = ?', [x])
 * SELECT → array of rows. INSERT/UPDATE/DELETE → { affectedRows, insertId, ... }.
 */
export async function query(text, params = []) {
  for (let attempt = 0; ; attempt++) {
    try {
      const [result] = await getPool().query(text, params);
      return result;
    } catch (e) {
      if (attempt >= 1 || !TRANSIENT.test(`${e.code || ''} ${e.message || ''}`)) throw e;
    }
  }
}

/** Tagged template: sql`SELECT * FROM t WHERE a = ${x}` — values become ? placeholders. */
export function sql(strings, ...values) {
  return query(strings.join('?'), values);
}
