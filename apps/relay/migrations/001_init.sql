CREATE TABLE IF NOT EXISTS devices (
  device_id text PRIMARY KEY,
  device_token text NOT NULL,
  created_at timestamptz NOT NULL,
  retention_days integer NOT NULL
);

CREATE TABLE IF NOT EXISTS pairing_tokens (
  token text PRIMARY KEY,
  device_id text NOT NULL REFERENCES devices(device_id),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS viewer_tokens (
  token text PRIMARY KEY,
  device_id text NOT NULL REFERENCES devices(device_id),
  expires_at timestamptz NOT NULL
);
