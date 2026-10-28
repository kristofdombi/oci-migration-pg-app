import { createMysql } from './mysql.js'
import { createPostgres } from './postgres.js'
import { createRedis } from './redis.js'

const ENGINES = [
  { name: 'postgres', url: process.env.POSTGRES_URL || process.env.DATABASE_URL, create: createPostgres },
  { name: 'mysql', url: process.env.MYSQL_URL, create: createMysql },
  { name: 'mariadb', url: process.env.MARIADB_URL, create: createMysql },
  { name: 'redis', url: process.env.REDIS_URL, create: createRedis },
  { name: 'valkey', url: process.env.VALKEY_URL, create: createRedis },
]

export const loadEngines = (only = []) => {
  const engines = ENGINES.filter(({ name, url }) => url && (!only.length || only.includes(name))).map(
    ({ name, url, create }) => create(name, url),
  )

  if (!engines.length) {
    console.error(
      'No database configured. Set at least one of POSTGRES_URL (or DATABASE_URL), MYSQL_URL, MARIADB_URL, REDIS_URL, VALKEY_URL',
    )
    process.exit(1)
  }

  return engines
}
