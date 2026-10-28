import http from 'node:http'
import { errorText, pool, TABLES } from './lib/db.js'
import { startWriter } from './lib/writer.js'

const PORT = Number(process.env.PORT || 8080)
const writer = startWriter('web_proc')

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body, null, 2))
}

const tableStats = async (table) => {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS rows,
            min(created_at) AS first_at,
            max(created_at) AS last_at,
            count(DISTINCT pod)::int AS pods,
            extract(epoch FROM now() - max(created_at))::float AS seconds_since_last
     FROM ${table}`,
  )
  return rows[0]
}

const seedStats = async () => {
  const { rows } = await pool.query(
    `SELECT i.seeded_at, i.seed_rows, i.seed_checksum AS expected_checksum,
            (SELECT count(*)::int FROM seed_data) AS current_rows,
            (SELECT md5(string_agg(id || ':' || payload, ',' ORDER BY id)) FROM seed_data) AS current_checksum
     FROM seed_info i WHERE i.id = 1`,
  )
  const seed = rows[0]
  return seed ? { ...seed, intact: seed.expected_checksum === seed.current_checksum } : null
}

const gaps = async (table, minSeconds, hours) => {
  const { rows } = await pool.query(
    `SELECT prev_at AS from_at, created_at AS to_at, extract(epoch FROM created_at - prev_at)::float AS seconds
     FROM (
       SELECT created_at, lag(created_at) OVER (ORDER BY created_at) AS prev_at
       FROM ${table}
       WHERE pod <> 'seed' AND created_at > now() - make_interval(hours => $2)
     ) s
     WHERE created_at - prev_at > make_interval(secs => $1)
     ORDER BY created_at`,
    [minSeconds, hours],
  )
  return rows
}

const routes = {
  '/healthz': async (_req, res) => json(res, 200, { ok: true }),
  '/': async (_req, res) => {
    try {
      const [db, webProc, bgWorker, seed] = await Promise.all([
        pool.query('SELECT now() AS db_now, version() AS version, inet_server_addr()::text AS server_addr'),
        tableStats('web_proc'),
        tableStats('bg_worker'),
        seedStats(),
      ])
      json(res, 200, {
        db: db.rows[0],
        tables: { web_proc: webProc, bg_worker: bgWorker },
        seed,
        writer: writer.state,
      })
    } catch (e) {
      json(res, 503, { error: errorText(e), writer: writer.state })
    }
  },
  '/gaps': async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const table = url.searchParams.get('table') || 'web_proc'
    if (!TABLES.includes(table)) {
      return json(res, 400, { error: `table must be one of ${TABLES.join(', ')}` })
    }
    const minSeconds = Number(url.searchParams.get('min') || 5)
    const hours = Number(url.searchParams.get('hours') || 24)
    try {
      json(res, 200, { table, minSeconds, hours, gaps: await gaps(table, minSeconds, hours) })
    } catch (e) {
      json(res, 503, { error: errorText(e) })
    }
  },
}

const server = http.createServer((req, res) => {
  const handler = routes[new URL(req.url, 'http://localhost').pathname]
  if (!handler) {
    return json(res, 404, { error: 'not found' })
  }
  handler(req, res)
})

server.listen(PORT, () => console.log(JSON.stringify({ msg: 'web listening', port: PORT })))

const shutdown = (signal) => {
  console.log(JSON.stringify({ msg: 'shutting down', signal, ...writer.state }))
  writer.stop()
  server.close(async () => {
    await pool.end().catch(() => {})
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 10000).unref()
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
