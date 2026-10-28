import http from 'node:http'
import os from 'node:os'
import { loadEngines } from './lib/engines/index.js'
import { errorText, TABLES } from './lib/seedData.js'
import { startWriter } from './lib/writer.js'

const PORT = Number(process.env.PORT || 8080)
const engines = loadEngines()
const writers = Object.fromEntries(engines.map((engine) => [engine.name, startWriter(engine, 'web_proc')]))

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body, null, 2))
}

const engineStatus = async (engine) => {
  const writer = writers[engine.name].state
  try {
    const [server, webProc, bgWorker, seed] = await Promise.all([
      engine.server(),
      engine.tableStats('web_proc'),
      engine.tableStats('bg_worker'),
      engine.seedStats(),
    ])
    return { ok: true, server, tables: { web_proc: webProc, bg_worker: bgWorker }, seed, writer }
  } catch (e) {
    return { ok: false, error: errorText(e), writer }
  }
}

const routes = {
  '/healthz': async (_req, res) => json(res, 200, { ok: true }),
  '/': async (_req, res) => {
    const statuses = await Promise.all(engines.map(engineStatus))
    const body = Object.fromEntries(engines.map((engine, index) => [engine.name, statuses[index]]))
    json(res, statuses.every(({ ok }) => ok) ? 200 : 503, { pod: os.hostname(), engines: body })
  },
  '/gaps': async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const engineName = url.searchParams.get('engine') || engines[0].name
    const engine = engines.find(({ name }) => name === engineName)
    if (!engine) {
      return json(res, 400, { error: `engine must be one of ${engines.map(({ name }) => name).join(', ')}` })
    }
    const table = url.searchParams.get('table') || 'web_proc'
    if (!TABLES.includes(table)) {
      return json(res, 400, { error: `table must be one of ${TABLES.join(', ')}` })
    }
    const minSeconds = Number(url.searchParams.get('min') || 5)
    const hours = Number(url.searchParams.get('hours') || 24)
    try {
      json(res, 200, { engine: engine.name, table, minSeconds, hours, gaps: await engine.gaps(table, minSeconds, hours) })
    } catch (e) {
      json(res, 503, { engine: engine.name, error: errorText(e) })
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

server.listen(PORT, () =>
  console.log(JSON.stringify({ msg: 'web listening', port: PORT, engines: engines.map(({ name }) => name) })),
)

const shutdown = (signal) => {
  console.log(JSON.stringify({ msg: 'shutting down', signal, writers: Object.values(writers).map(({ state }) => state) }))
  Object.values(writers).forEach((writer) => writer.stop())
  server.close(async () => {
    await Promise.all(engines.map((engine) => engine.close().catch(() => {})))
    process.exit(0)
  })
  setTimeout(() => process.exit(0), 10000).unref()
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
