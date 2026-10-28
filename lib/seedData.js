import { createHash } from 'node:crypto'

export const SEED_ROWS = 10000
export const TABLES = ['web_proc', 'bg_worker']

const md5 = (text) => createHash('md5').update(text).digest('hex')

export const seedRows = () =>
  Array.from({ length: SEED_ROWS }, (_, index) => ({
    id: index + 1,
    payload: md5(`sevalla-oci-migration-${index + 1}`),
  }))

export const checksumRows = (rows) =>
  md5(
    [...rows]
      .sort((a, b) => Number(a.id) - Number(b.id))
      .map(({ id, payload }) => `${id}:${payload}`)
      .join(','),
  )

export const chunk = (items, size) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size))

export const errorText = (e) => e.message || e.code || e.errors?.map((inner) => inner.message).join('; ') || String(e)

export const toIso = (epochSeconds) =>
  epochSeconds === null || epochSeconds === undefined ? null : new Date(Number(epochSeconds) * 1000).toISOString()
