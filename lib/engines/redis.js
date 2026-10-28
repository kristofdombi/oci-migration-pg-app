import Redis from 'ioredis'
import { checksumRows, chunk, errorText, seedRows } from '../seedData.js'

const READY_TIMEOUT_MS = 5000

const entryMs = (id) => Number(id.split('-')[0])

const fieldsOf = (values) =>
  Object.fromEntries(Array.from({ length: values.length / 2 }, (_, index) => [values[index * 2], values[index * 2 + 1]]))

const parseInfo = (text) =>
  Object.fromEntries(
    text
      .split('\r\n')
      .filter((line) => line.includes(':'))
      .map((line) => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1)]),
  )

export const createRedis = (name, url) => {
  const client = new Redis(url, {
    connectTimeout: 5000,
    commandTimeout: 5000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 500, 2000),
  })

  let lastError = null
  client.on('error', (e) => {
    const error = errorText(e)
    if (error !== lastError) {
      console.error(JSON.stringify({ msg: 'connection error', engine: name, error }))
      lastError = error
    }
  })
  client.on('ready', () => {
    lastError = null
  })

  const nowMs = async () => {
    const [seconds, micros] = await client.time()
    return Number(seconds) * 1000 + Math.floor(Number(micros) / 1000)
  }

  const seedStats = async () => {
    const info = await client.hgetall('seed_info')
    if (!info.seed_checksum) {
      return null
    }
    const data = await client.hgetall('seed_data')
    const rows = Object.entries(data).map(([id, payload]) => ({ id: Number(id), payload }))
    const currentChecksum = checksumRows(rows)
    return {
      seeded_at: info.seeded_at,
      seed_rows: Number(info.seed_rows),
      current_rows: rows.length,
      expected_checksum: info.seed_checksum,
      current_checksum: currentChecksum,
      intact: info.seed_checksum === currentChecksum,
    }
  }

  return {
    name,
    ready: () =>
      client.status === 'ready'
        ? Promise.resolve()
        : new Promise((resolve) => {
            const timer = setTimeout(resolve, READY_TIMEOUT_MS)
            client.once('ready', () => {
              clearTimeout(timer)
              resolve()
            })
          }),
    insert: (table, { seq, pod, clientTs }) =>
      client.xadd(table, '*', 'seq', seq, 'pod', pod, 'client_ts', clientTs.toISOString()),
    server: async () => {
      const info = parseInfo(await client.info('server'))
      const persistence = parseInfo(await client.info('persistence'))
      return {
        db_now: new Date(await nowMs()).toISOString(),
        version: info.valkey_version ? `valkey ${info.valkey_version}` : `redis ${info.redis_version}`,
        server: info.run_id,
        uptime_seconds: Number(info.uptime_in_seconds),
        aof_enabled: persistence.aof_enabled === '1',
        rdb_last_save: new Date(Number(persistence.rdb_last_save_time) * 1000).toISOString(),
      }
    },
    tableStats: async (table) => {
      const [rows, first, last, now] = await Promise.all([
        client.xlen(table),
        client.xrange(table, '-', '+', 'COUNT', 1),
        client.xrevrange(table, '+', '-', 'COUNT', 1),
        nowMs(),
      ])
      const lastMs = last[0] ? entryMs(last[0][0]) : null
      return {
        rows,
        first_at: first[0] ? new Date(entryMs(first[0][0])).toISOString() : null,
        last_at: lastMs ? new Date(lastMs).toISOString() : null,
        pods: null,
        seconds_since_last: lastMs ? (now - lastMs) / 1000 : null,
      }
    },
    gaps: async (table, minSeconds, hours) => {
      const since = (await nowMs()) - hours * 3600 * 1000
      const entries = (await client.xrange(table, String(since), '+')).filter(
        ([, values]) => fieldsOf(values).pod !== 'seed',
      )
      return entries.flatMap(([id], index) => {
        if (index === 0) {
          return []
        }
        const from = entryMs(entries[index - 1][0])
        const to = entryMs(id)
        const seconds = (to - from) / 1000
        return seconds > minSeconds
          ? [{ from_at: new Date(from).toISOString(), to_at: new Date(to).toISOString(), seconds }]
          : []
      })
    },
    seedStats,
    seed: async () => {
      for (const rows of chunk(seedRows(), 1000)) {
        await client.hset('seed_data', Object.fromEntries(rows.map(({ id, payload }) => [id, payload])))
      }
      if (!(await client.exists('seed_info'))) {
        const data = await client.hgetall('seed_data')
        const rows = Object.entries(data).map(([id, payload]) => ({ id: Number(id), payload }))
        const now = new Date().toISOString()
        await client.hset('seed_info', {
          seeded_at: now,
          seed_rows: rows.length,
          seed_checksum: checksumRows(rows),
        })
        for (const table of ['web_proc', 'bg_worker']) {
          await client.xadd(table, '*', 'seq', 0, 'pod', 'seed', 'client_ts', now)
        }
      }
      return seedStats()
    },
    close: () => client.quit().catch(() => client.disconnect()),
  }
}
