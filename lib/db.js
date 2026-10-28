import pg from 'pg'

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
  statement_timeout: 5000,
  query_timeout: 6000,
})

pool.on('error', (e) => {
  console.error(JSON.stringify({ msg: 'idle client error', error: errorText(e) }))
})

export const TABLES = ['web_proc', 'bg_worker']

export const errorText = (e) => e.message || e.code || e.errors?.map((inner) => inner.message).join('; ') || String(e)
