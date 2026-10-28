# oci-migration-pg-app

Test app for the Sevalla GCP to OCI migration. Two processes write to PostgreSQL every 2 seconds, so any write outage during the move shows up as a gap.

| Process | Command | Table |
|---|---|---|
| web | `node web.js` | `web_proc` |
| worker | `node worker.js` | `bg_worker` |

Both read `DATABASE_URL`. `WRITE_INTERVAL_MS` overrides the 2 second interval.

## Seed

`npm run seed` creates the tables and fills `seed_data` with 10,000 rows. Their checksum goes into `seed_info`, so you can check after the move that the data came over intact. The seed is idempotent.

## Endpoints

- `GET /healthz` - liveness, never touches the database
- `GET /` - row counts and last write per table, seed checksum check, and the web writer's failure and outage history
- `GET /gaps?table=web_proc|bg_worker&min=5&hours=24` - every gap between consecutive rows longer than `min` seconds

The worker logs `write failing` and `write recovered` (with the outage length) to stdout.
