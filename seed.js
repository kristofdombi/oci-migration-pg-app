import { loadEngines } from './lib/engines/index.js'
import { errorText } from './lib/seedData.js'

const engines = loadEngines(process.argv.slice(2))

for (const engine of engines) {
  try {
    await engine.ready()
    const seed = await engine.seed()
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
