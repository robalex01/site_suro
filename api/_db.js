/**
 * api/_db.js — shared MySQL / MariaDB access for every API route.
 *
 * (The leading underscore makes Vercel ignore this file as a route; it is
 * only ever imported.)
 *
 * Connection, from the Vercel environment variables:
 *   DATABASE_URL = mysql://user:password@host:3306/dbname   (URL-encode special chars in the password)
 *   — or —
 *   DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME     (no encoding needed; wins over DATABASE_URL)
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

function buildOptions() {
  const env = process.env;
  let base;

  if (env.DB_HOST) {
    base = {
      host:     env.DB_HOST,
      port:     parseInt(env.DB_PORT, 10) || 3306,
      user:     env.DB_USER,
      password: env.DB_PASSWORD || '',
      database: env.DB_NAME,
    };
  } else {
    if (!env.DATABASE_URL) throw new Error('DATABASE_URL not configured');
    let url;
    try { url = new URL(env.DATABASE_URL); }
    catch { throw new Error('DATABASE_URL is not a valid URL (expected mysql://user:password@host:3306/dbname)'); }
    if (!/^(mysql|mariadb):$/.test(url.protocol)) {
      throw new Error(`DATABASE_URL must start with mysql:// (got "${url.protocol}//") — the old Neon/Postgres URL must be replaced.`);
    }
    base = {
      host:     url.hostname,
      port:     Number(url.port) || 3306,
      user:     decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    };
    const ssl = url.searchParams.get('ssl');
    if (ssl === 'true' || ssl === '1') base.ssl = { rejectUnauthorized: false };
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
