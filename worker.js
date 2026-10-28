import { pool } from './lib/db.js'
import { startWriter } from './lib/writer.js'

const writer = startWriter('bg_worker')

const shutdown = async (signal) => {
  console.log(JSON.stringify({ msg: 'shutting down', signal, ...writer.state }))
  writer.stop()
  await pool.end().catch(() => {})
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
