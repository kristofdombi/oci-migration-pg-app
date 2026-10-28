import { readFile } from 'node:fs/promises'
import { pool } from './lib/db.js'

const sql = await readFile(new URL('./seed.sql', import.meta.url), 'utf8')
const client = await pool.connect()

try {
  await client.query('BEGIN')
  await client.query(sql)
  await client.query('COMMIT')
  const { rows } = await client.query('SELECT seeded_at, seed_rows, seed_checksum FROM seed_info WHERE id = 1')
  console.log(JSON.stringify({ msg: 'seed done', ...rows[0] }))
} catch (e) {
  await client.query('ROLLBACK')
  console.error(JSON.stringify({ msg: 'seed failed', error: e.message }))
  process.exitCode = 1
} finally {
  client.release()
  await pool.end()
}
