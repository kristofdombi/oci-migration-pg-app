import pg from 'pg'
import { checksumRows, chunk, errorText, seedRows } from '../seedData.js'

const writeTable = (table) => `
  CREATE TABLE IF NOT EXISTS ${table} (
    id bigserial PRIMARY KEY,
    seq bigint NOT NULL,
    pod text NOT NULL,
    client_ts timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS ${table}_created_at_idx ON ${table} (created_at);
`

const SCHEMA = `
  ${writeTable('web_proc')}
  ${writeTable('bg_worker')}
  CREATE TABLE IF NOT EXISTS seed_data (id integer PRIMARY KEY, payload text NOT NULL);
  CREATE TABLE IF NOT EXISTS seed_info (
    id integer PRIMARY KEY,
    seeded_at timestamptz NOT NULL DEFAULT now(),
    seed_rows integer NOT NULL,
    seed_checksum text NOT NULL
  );
`

export const createPostgres = (name, url) => {
  const pool = new pg.Pool({
    connectionString: url,
    max: 4,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10000,
    statement_timeout: 5000,
    query_timeout: 6000,
  })

  pool.on('error', (e) => console.error(JSON.stringify({ msg: 'idle client error', engine: name, error: errorText(e) })))

  const query = async (sql, params = []) => (await pool.query(sql, params)).rows

  const seedStats = async () => {
    const [info] = await query('SELECT seeded_at, seed_rows, seed_checksum FROM seed_info WHERE id = 1')
    if (!info) {
      return null
    }
    const rows = await query('SELECT id, payload FROM seed_data ORDER BY id')
    const currentChecksum = checksumRows(rows)
    return {
      seeded_at: info.seeded_at,
      seed_rows: info.seed_rows,
      current_rows: rows.length,
      expected_checksum: info.seed_checksum,
      current_checksum: currentChecksum,
      intact: info.seed_checksum === currentChecksum,
    }
  }

  return {
    name,
    ready: async () => {},
    insert: (table, { seq, pod, clientTs }) =>
      pool.query(`INSERT INTO ${table} (seq, pod, client_ts) VALUES ($1, $2, $3)`, [seq, pod, clientTs]),
    server: async () =>
      (
        await query(
          `SELECT now() AS db_now, version() AS version, inet_server_addr()::text AS server,
                  s.ssl, s.version AS ssl_version, s.cipher AS ssl_cipher
           FROM pg_stat_ssl s WHERE s.pid = pg_backend_pid()`,
        )
      )[0],
    tableStats: async (table) =>
      (
        await query(
          `SELECT count(*)::int AS rows, min(created_at) AS first_at, max(created_at) AS last_at,
                  count(DISTINCT pod)::int AS pods,
                  extract(epoch FROM now() - max(created_at))::float AS seconds_since_last
           FROM ${table}`,
        )
      )[0],
    gaps: (table, minSeconds, hours) =>
      query(
        `SELECT prev_at AS from_at, created_at AS to_at, extract(epoch FROM created_at - prev_at)::float AS seconds
         FROM (
           SELECT created_at, lag(created_at) OVER (ORDER BY created_at) AS prev_at
           FROM ${table}
           WHERE pod <> 'seed' AND created_at > now() - make_interval(hours => $2)
         ) s
         WHERE created_at - prev_at > make_interval(secs => $1)
         ORDER BY created_at`,
        [minSeconds, hours],
      ),
    seedStats,
    seed: async () => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query(SCHEMA)
        for (const rows of chunk(seedRows(), 1000)) {
          await client.query(
            'INSERT INTO seed_data (id, payload) SELECT * FROM unnest($1::int[], $2::text[]) ON CONFLICT (id) DO NOTHING',
            [rows.map(({ id }) => id), rows.map(({ payload }) => payload)],
          )
        }
        const { rows } = await client.query('SELECT id, payload FROM seed_data ORDER BY id')
        await client.query(
          'INSERT INTO seed_info (id, seed_rows, seed_checksum) VALUES (1, $1, $2) ON CONFLICT (id) DO NOTHING',
          [rows.length, checksumRows(rows)],
        )
        for (const table of ['web_proc', 'bg_worker']) {
          await client.query(
            `INSERT INTO ${table} (seq, pod, client_ts) SELECT 0, 'seed', now()
             WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE pod = 'seed')`,
          )
        }
        await client.query('COMMIT')
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {})
        throw e
      } finally {
        client.release()
      }
      return seedStats()
    },
    close: () => pool.end(),
  }
}
