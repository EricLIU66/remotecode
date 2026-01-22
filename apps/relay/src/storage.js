import crypto from "crypto";
import { Pool } from "pg";
import { config } from "./config.js";

const pairingTtlMs = 5 * 60 * 1000;
const viewerTtlMs = 30 * 24 * 60 * 60 * 1000;

const nowMs = () => Date.now();
const createToken = () => crypto.randomBytes(24).toString("hex");

const createInMemoryStorage = () => {
  const devices = new Map();
  const pairingTokens = new Map();
  const viewerTokens = new Map();

  const createPairingRequest = () => {
    const deviceId = crypto.randomUUID();
    const deviceToken = createToken();
    const pairingToken = createToken();
    const expiresAtMs = nowMs() + pairingTtlMs;

    devices.set(deviceId, {
      deviceToken,
      createdAtMs: nowMs(),
      retentionDays: 30,
    });

    pairingTokens.set(pairingToken, {
      deviceId,
      expiresAtMs,
    });

    return {
      deviceId,
      deviceToken,
      pairingToken,
      expiresAtMs,
    };
  };

  const confirmPairing = (pairingToken) => {
    const entry = pairingTokens.get(pairingToken);
    if (!entry) {
      return null;
    }

    if (entry.expiresAtMs <= nowMs()) {
      pairingTokens.delete(pairingToken);
      return null;
    }

    pairingTokens.delete(pairingToken);

    const viewerToken = createToken();
    const expiresAtMs = nowMs() + viewerTtlMs;

    viewerTokens.set(viewerToken, {
      deviceId: entry.deviceId,
      expiresAtMs,
    });

    return {
      viewerToken,
      deviceId: entry.deviceId,
    };
  };

  const validateDevice = (deviceId, deviceToken) => {
    const device = devices.get(deviceId);
    if (!device || device.deviceToken !== deviceToken) {
      return false;
    }

    return true;
  };

  const validateViewer = (viewerToken) => {
    const entry = viewerTokens.get(viewerToken);
    if (!entry) {
      return null;
    }

    if (entry.expiresAtMs <= nowMs()) {
      viewerTokens.delete(viewerToken);
      return null;
    }

    return entry.deviceId;
  };

  return {
    createPairingRequest,
    confirmPairing,
    validateDevice,
    validateViewer,
    kind: "memory",
  };
};

const createPostgresStorage = async () => {
  const pool = new Pool({ connectionString: config.databaseUrl });

  await pool.query(
    "CREATE TABLE IF NOT EXISTS devices (device_id text primary key, device_token text not null, created_at timestamptz not null, retention_days integer not null)"
  );
  await pool.query(
    "CREATE TABLE IF NOT EXISTS pairing_tokens (token text primary key, device_id text not null references devices(device_id), expires_at timestamptz not null)"
  );
  await pool.query(
    "CREATE TABLE IF NOT EXISTS viewer_tokens (token text primary key, device_id text not null references devices(device_id), expires_at timestamptz not null)"
  );

  const createPairingRequest = async () => {
    const deviceId = crypto.randomUUID();
    const deviceToken = createToken();
    const pairingToken = createToken();
    const expiresAtMs = nowMs() + pairingTtlMs;

    await pool.query(
      "INSERT INTO devices (device_id, device_token, created_at, retention_days) VALUES ($1, $2, NOW(), $3)",
      [deviceId, deviceToken, 30]
    );

    await pool.query(
      "INSERT INTO pairing_tokens (token, device_id, expires_at) VALUES ($1, $2, $3)",
      [pairingToken, deviceId, new Date(expiresAtMs)]
    );

    return {
      deviceId,
      deviceToken,
      pairingToken,
      expiresAtMs,
    };
  };

  const confirmPairing = async (pairingToken) => {
    const result = await pool.query(
      "SELECT device_id, expires_at FROM pairing_tokens WHERE token = $1",
      [pairingToken]
    );

    if (result.rowCount === 0) {
      return null;
    }

    const { device_id: deviceId, expires_at: expiresAt } = result.rows[0];
    const expiresAtMs = new Date(expiresAt).getTime();

    if (expiresAtMs <= nowMs()) {
      await pool.query("DELETE FROM pairing_tokens WHERE token = $1", [pairingToken]);
      return null;
    }

    await pool.query("DELETE FROM pairing_tokens WHERE token = $1", [pairingToken]);

    const viewerToken = createToken();
    const viewerExpiresAtMs = nowMs() + viewerTtlMs;

    await pool.query(
      "INSERT INTO viewer_tokens (token, device_id, expires_at) VALUES ($1, $2, $3)",
      [viewerToken, deviceId, new Date(viewerExpiresAtMs)]
    );

    return { viewerToken, deviceId };
  };

  const validateDevice = async (deviceId, deviceToken) => {
    const result = await pool.query(
      "SELECT device_token FROM devices WHERE device_id = $1",
      [deviceId]
    );

    if (result.rowCount === 0) {
      return false;
    }

    return result.rows[0].device_token === deviceToken;
  };

  const validateViewer = async (viewerToken) => {
    const result = await pool.query(
      "SELECT device_id, expires_at FROM viewer_tokens WHERE token = $1",
      [viewerToken]
    );

    if (result.rowCount === 0) {
      return null;
    }

    const { device_id: deviceId, expires_at: expiresAt } = result.rows[0];
    const expiresAtMs = new Date(expiresAt).getTime();

    if (expiresAtMs <= nowMs()) {
      await pool.query("DELETE FROM viewer_tokens WHERE token = $1", [viewerToken]);
      return null;
    }

    return deviceId;
  };

  return {
    createPairingRequest,
    confirmPairing,
    validateDevice,
    validateViewer,
    kind: "postgres",
  };
};

export const createStorage = async () => {
  if (!config.databaseUrl) {
    return createInMemoryStorage();
  }

  return createPostgresStorage();
};
