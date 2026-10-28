import { setTimeout as sleep } from 'node:timers/promises'
import { loadEngines } from './lib/engines/index.js'
import { errorText } from './lib/seedData.js'

const SEED_TIMEOUT_MS = Number(process.env.SEED_TIMEOUT_MS || 120000)
const RETRY_DELAY_MS = 3000

const seedWithRetry = async (engine) => {
  const deadline = Date.now() + SEED_TIMEOUT_MS
  for (let attempt = 1; ; attempt++) {
    try {
      await engine.ready()
      return await engine.seed()
    } catch (e) {
      if (Date.now() + RETRY_DELAY_MS > deadline) {
        throw e
      }
      console.log(JSON.stringify({ msg: 'seed retrying', engine: engine.name, attempt, error: errorText(e) }))
      await sleep(RETRY_DELAY_MS)
    }
  }
}

const engines = loadEngines(process.argv.slice(2))

for (const engine of engines) {
  try {
    const seed = await seedWithRetry(engine)
    console.log(JSON.stringify({ msg: 'seed done', engine: engine.name, ...seed }))
    if (!seed?.intact) {
      process.exitCode = 1
    }
  } catch (e) {
    console.error(JSON.stringify({ msg: 'seed failed', engine: engine.name, error: errorText(e) }))
    process.exitCode = 1
  } finally {
    await engine.close().catch(() => {})
  }
}
