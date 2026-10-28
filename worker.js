import { loadEngines } from './lib/engines/index.js'
import { startWriter } from './lib/writer.js'

const engines = loadEngines()
const writers = engines.map((engine) => startWriter(engine, 'bg_worker'))

const shutdown = async (signal) => {
  console.log(JSON.stringify({ msg: 'shutting down', signal, writers: writers.map(({ state }) => state) }))
  writers.forEach((writer) => writer.stop())
  await Promise.all(engines.map((engine) => engine.close().catch(() => {})))
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
