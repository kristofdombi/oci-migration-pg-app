import os from 'node:os'
import { errorText, pool } from './db.js'

const INTERVAL_MS = Number(process.env.WRITE_INTERVAL_MS || 2000)
const MAX_OUTAGES = 20

const log = (msg, extra = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), msg, ...extra }))

export const startWriter = (table) => {
  const pod = os.hostname()
  const state = {
    table,
    pod,
    intervalMs: INTERVAL_MS,
    seq: 0,
    ok: 0,
    failed: 0,
    lastSuccessAt: null,
    lastError: null,
    outageStartedAt: null,
    outages: [],
  }
  let timer = null
  let stopped = false

  const write = async () => {
    state.seq += 1
    const clientTs = new Date()
    try {
      await pool.query(`INSERT INTO ${table} (seq, pod, client_ts) VALUES ($1, $2, $3)`, [state.seq, pod, clientTs])
      state.ok += 1
      state.lastSuccessAt = new Date().toISOString()
      if (state.outageStartedAt) {
        const outage = {
          startedAt: state.outageStartedAt,
          endedAt: state.lastSuccessAt,
          seconds: (Date.now() - Date.parse(state.outageStartedAt)) / 1000,
          lastError: state.lastError,
        }
        state.outages = [outage, ...state.outages].slice(0, MAX_OUTAGES)
        state.outageStartedAt = null
        log('write recovered', { table, ...outage })
      }
    } catch (e) {
      state.failed += 1
      state.lastError = errorText(e)
      if (!state.outageStartedAt) {
        state.outageStartedAt = clientTs.toISOString()
        log('write failing', { table, seq: state.seq, error: errorText(e) })
      }
    }
  }

  const tick = async () => {
    const started = Date.now()
    await write()
    if (!stopped) {
      timer = setTimeout(tick, Math.max(0, INTERVAL_MS - (Date.now() - started)))
    }
  }

  log('writer started', { table, pod, intervalMs: INTERVAL_MS })
  tick()

  return {
    state,
    stop: () => {
      stopped = true
      clearTimeout(timer)
    },
  }
}
