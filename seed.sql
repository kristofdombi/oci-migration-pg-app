CREATE TABLE IF NOT EXISTS web_proc (
  id bigserial PRIMARY KEY,
  seq bigint NOT NULL,
  pod text NOT NULL,
  client_ts timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS web_proc_created_at_idx ON web_proc (created_at);

CREATE TABLE IF NOT EXISTS bg_worker (
  id bigserial PRIMARY KEY,
  seq bigint NOT NULL,
  pod text NOT NULL,
  client_ts timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bg_worker_created_at_idx ON bg_worker (created_at);

CREATE TABLE IF NOT EXISTS seed_data (
  id integer PRIMARY KEY,
  payload text NOT NULL
);

INSERT INTO seed_data (id, payload)
SELECT i, md5('sevalla-oci-migration-' || i)
FROM generate_series(1, 10000) AS i
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS seed_info (
  id integer PRIMARY KEY,
  seeded_at timestamptz NOT NULL DEFAULT now(),
  seed_rows integer NOT NULL,
  seed_checksum text NOT NULL
);

INSERT INTO seed_info (id, seed_rows, seed_checksum)
SELECT 1, count(*), md5(string_agg(id || ':' || payload, ',' ORDER BY id))
FROM seed_data
ON CONFLICT (id) DO NOTHING;

INSERT INTO web_proc (seq, pod, client_ts)
SELECT 0, 'seed', now()
WHERE NOT EXISTS (SELECT 1 FROM web_proc WHERE pod = 'seed');

INSERT INTO bg_worker (seq, pod, client_ts)
SELECT 0, 'seed', now()
WHERE NOT EXISTS (SELECT 1 FROM bg_worker WHERE pod = 'seed');
