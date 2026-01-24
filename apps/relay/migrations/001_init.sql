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

CREATE TABLE IF NOT EXISTS snapshots (
  device_id text PRIMARY KEY REFERENCES devices(device_id),
  agent_states jsonb NOT NULL,
  session_summary jsonb,
  ts timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  device_id text NOT NULL REFERENCES devices(device_id),
  event_type text NOT NULL,
  severity text NOT NULL,
  payload jsonb NOT NULL,
  ts timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS events_device_ts_idx ON events (device_id, ts DESC);
