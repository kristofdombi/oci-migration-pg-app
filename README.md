# oci-migration-pg-app

Test app for the Sevalla GCP to OCI migration. Two processes write to every configured database every 2 seconds, so any write outage during the move shows up as a gap.

| Process | Command | Writes to |
|---|---|---|
| web | `node web.js` | `web_proc` |
| worker | `node worker.js` | `bg_worker` |

## Databases

Each database is optional. Set the URL of the ones you want to test:

| Engine | Env var | URL format |
|---|---|---|
| PostgreSQL | `POSTGRES_URL` (or `DATABASE_URL`) | `postgres://user:password@host:5432/db` |
| MySQL | `MYSQL_URL` | `mysql://user:password@host:3306/db` |
| MariaDB | `MARIADB_URL` | `mysql://user:password@host:3306/db` |
| Redis | `REDIS_URL` | `redis://default:password@host:6379` |
| Valkey | `VALKEY_URL` | `redis://default:password@host:6379` |

`POSTGRES_SSL_CA` (a PEM CA certificate, `\n` escapes allowed) makes the Postgres connection use TLS and verify the server certificate against that CA and the host name, like `sslmode=verify-full`. Leave `sslmode` out of `POSTGRES_URL` when you set it.

`WRITE_INTERVAL_MS` overrides the 2 second interval.

SQL engines get `web_proc` and `bg_worker` tables (`id`, `seq`, `pod`, `client_ts`, `created_at`). Redis and Valkey get streams with the same names, whose entry IDs carry the server time.

`seq` is a counter per process and starts again at 1 in every new pod. Each pod's numbers have no holes unless writes failed, and the `pod` column shows which pod wrote a row.

## Seed

`npm run seed` (or `node seed.js postgres mysql` for some engines only) creates the tables and fills `seed_data` with 10,000 rows (a hash with 10,000 fields on Redis and Valkey). Their checksum goes into `seed_info`, so you can check after the move that the data came over intact. The checksum is the same on every engine. The seed is idempotent, retries for up to 2 minutes while a database is unreachable (`SEED_TIMEOUT_MS`), and exits non-zero when it fails.

On Sevalla, seed from inside the cluster, for example with a job process (`node seed.js`, start policy `beforeDeployment`). Don't turn on a database's external connection to seed it: closing it keeps a port reserved on the database, and the migration then counts it as a database with public access.

## Endpoints

- `GET /healthz` - liveness, never touches a database
- `GET /` - per engine: server identity (and for Postgres whether the connection uses TLS), row counts and last write per table, seed checksum check, and the web writer's failure and outage history. Returns 503 when any engine fails.
- `GET /gaps?engine=postgres&table=web_proc&min=5&hours=24` - every gap between consecutive writes longer than `min` seconds

Both processes log `write failing` and `write recovered` (with the outage length) to stdout.
