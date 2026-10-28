import mysql from 'mysql2/promise'
import { checksumRows, chunk, seedRows, toIso } from '../seedData.js'

const writeTable = (table) => `
  CREATE TABLE IF NOT EXISTS ${table} (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    seq BIGINT NOT NULL,
    pod VARCHAR(255) NOT NULL,
    client_ts DATETIME(6) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    INDEX ${table}_created_at_idx (created_at)
  )
`

const SCHEMA = [
  writeTable('web_proc'),
  writeTable('bg_worker'),
  'CREATE TABLE IF NOT EXISTS seed_data (id INT PRIMARY KEY, payload VARCHAR(32) NOT NULL)',
  `CREATE TABLE IF NOT EXISTS seed_info (
    id INT PRIMARY KEY,
    seeded_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    seed_rows INT NOT NULL,
    seed_checksum VARCHAR(32) NOT NULL
  )`,
]

export const createMysql = (name, url) => {
  const pool = mysql.createPool({
    uri: url,
    connectionLimit: 4,
    connectTimeout: 5000,
    decimalNumbers: true,
    timezone: 'Z',
    enableKeepAlive: true,
  })

  const query = async (sql, params = []) => (await pool.query({ sql, timeout: 6000 }, params))[0]

  const seedStats = async () => {
    const [info] = await query(
      'SELECT UNIX_TIMESTAMP(seeded_at) AS seeded_at, seed_rows, seed_checksum FROM seed_info WHERE id = 1',
    )
    if (!info) {
      return null
    }
    const rows = await query('SELECT id, payload FROM seed_data ORDER BY id')
    const currentChecksum = checksumRows(rows)
    return {
      seeded_at: toIso(info.seeded_at),
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
      query(`INSERT INTO ${table} (seq, pod, client_ts) VALUES (?, ?, ?)`, [seq, pod, clientTs]),
    server: async () => {
      const [row] = await query('SELECT UNIX_TIMESTAMP(NOW(6)) AS db_now, VERSION() AS version, @@hostname AS server')
      return { ...row, db_now: toIso(row.db_now) }
    },
    tableStats: async (table) => {
      const [row] = await query(
        `SELECT COUNT(*) AS \`rows\`, UNIX_TIMESTAMP(MIN(created_at)) AS first_at,
                UNIX_TIMESTAMP(MAX(created_at)) AS last_at, COUNT(DISTINCT pod) AS pods,
                UNIX_TIMESTAMP(NOW(6)) - UNIX_TIMESTAMP(MAX(created_at)) AS seconds_since_last
         FROM ${table}`,
      )
      return { ...row, first_at: toIso(row.first_at), last_at: toIso(row.last_at) }
    },
    gaps: async (table, minSeconds, hours) => {
      const rows = await query(
        `SELECT prev_at, cur_at, cur_at - prev_at AS seconds
         FROM (
           SELECT UNIX_TIMESTAMP(created_at) AS cur_at,
                  LAG(UNIX_TIMESTAMP(created_at)) OVER (ORDER BY created_at, id) AS prev_at
           FROM ${table}
           WHERE pod <> 'seed' AND created_at > NOW(6) - INTERVAL ? HOUR
         ) s
         WHERE cur_at - prev_at > ?
         ORDER BY cur_at`,
        [hours, minSeconds],
      )
      return rows.map(({ prev_at, cur_at, seconds }) => ({
        from_at: toIso(prev_at),
        to_at: toIso(cur_at),
        seconds: Number(seconds),
      }))
    },
    seedStats,
    seed: async () => {
      for (const statement of SCHEMA) {
        await query(statement)
      }
      for (const rows of chunk(seedRows(), 1000)) {
        await query('INSERT IGNORE INTO seed_data (id, payload) VALUES ?', [rows.map(({ id, payload }) => [id, payload])])
      }
      const rows = await query('SELECT id, payload FROM seed_data ORDER BY id')
      await query('INSERT IGNORE INTO seed_info (id, seed_rows, seed_checksum) VALUES (1, ?, ?)', [
        rows.length,
        checksumRows(rows),
      ])
      for (const table of ['web_proc', 'bg_worker']) {
        const [{ seeded }] = await query(`SELECT COUNT(*) AS seeded FROM ${table} WHERE pod = 'seed'`)
        if (!seeded) {
          await query(`INSERT INTO ${table} (seq, pod, client_ts) VALUES (0, 'seed', NOW(6))`)
        }
      }
      return seedStats()
    },
    close: () => pool.end(),
  }
}
