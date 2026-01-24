import crypto from "crypto";
import { Pool } from "pg";
import { config } from "./config.js";

const pairingTtlMs = 5 * 60 * 1000;
const viewerTtlMs = 30 * 24 * 60 * 60 * 1000;
const maxEventsPerDevice = 500;

const nowMs = () => Date.now();
const createToken = () => crypto.randomBytes(24).toString("hex");

const createInMemoryStorage = () => {
  const devices = new Map();
  const pairingTokens = new Map();
  const viewerTokens = new Map();
  const snapshots = new Map();
  const events = new Map();

  const cleanupExpiredTokens = () => {
    for (const [token, entry] of pairingTokens) {
      if (entry.expiresAtMs <= nowMs()) {
        pairingTokens.delete(token);
      }
    }

    for (const [token, entry] of viewerTokens) {
      if (entry.expiresAtMs <= nowMs()) {
        viewerTokens.delete(token);
      }
    }
  };

  const resolveDevice = ({ deviceId, deviceToken } = {}) => {
    if (!deviceId || !deviceToken) {
      return null;
    }

    const device = devices.get(deviceId);
    if (!device || device.deviceToken !== deviceToken) {
      return null;
    }

    return { deviceId, deviceToken };
  };

  const createPairingRequest = ({ deviceId, deviceToken } = {}) => {
    const existingDevice = resolveDevice({ deviceId, deviceToken });
    const resolvedDeviceId = existingDevice?.deviceId ?? crypto.randomUUID();
    const resolvedDeviceToken = existingDevice?.deviceToken ?? createToken();
    const pairingToken = createToken();
    const expiresAtMs = nowMs() + pairingTtlMs;

    if (!existingDevice) {
      devices.set(resolvedDeviceId, {
        deviceToken: resolvedDeviceToken,
        createdAtMs: nowMs(),
        retentionDays: 30,
      });
    }

    pairingTokens.set(pairingToken, {
      deviceId: resolvedDeviceId,
      expiresAtMs,
    });

    return {
      deviceId: resolvedDeviceId,
      deviceToken: resolvedDeviceToken,
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

  const saveSnapshot = ({ deviceId, agentStates, sessionSummary, ts } = {}) => {
    if (!deviceId) {
      return;
    }

    snapshots.set(deviceId, {
      deviceId,
      agentStates,
      sessionSummary,
      ts: ts ?? new Date().toISOString(),
    });
  };

  const appendEvent = ({ deviceId, eventType, severity, payload, ts } = {}) => {
    if (!deviceId || !eventType) {
      return;
    }

    const entry = {
      deviceId,
      eventType,
      severity: severity ?? "info",
      payload,
      ts: ts ?? new Date().toISOString(),
    };

    const existing = events.get(deviceId) ?? [];
    const nextEvents = [entry, ...existing].slice(0, maxEventsPerDevice);
    events.set(deviceId, nextEvents);
  };

  return {
    cleanupExpiredTokens,
    createPairingRequest,
    confirmPairing,
    validateDevice,
    validateViewer,
    saveSnapshot,
    appendEvent,
    kind: "memory",
  };
};

const createPostgresStorage = async () => {
  const pool = new Pool({ connectionString: config.databaseUrl });

  const cleanupExpiredTokens = async () => {
    await pool.query("DELETE FROM pairing_tokens WHERE expires_at <= NOW()");
    await pool.query("DELETE FROM viewer_tokens WHERE expires_at <= NOW()");
  };

  const resolveDevice = async ({ deviceId, deviceToken } = {}) => {
    if (!deviceId || !deviceToken) {
      return null;
    }

    const result = await pool.query(
      "SELECT device_token FROM devices WHERE device_id = $1",
      [deviceId]
    );

    if (result.rowCount === 0 || result.rows[0].device_token !== deviceToken) {
      return null;
    }

    return { deviceId, deviceToken };
  };

  const createPairingRequest = async ({ deviceId, deviceToken } = {}) => {
    const existingDevice = await resolveDevice({ deviceId, deviceToken });
    const resolvedDeviceId = existingDevice?.deviceId ?? crypto.randomUUID();
    const resolvedDeviceToken = existingDevice?.deviceToken ?? createToken();
    const pairingToken = createToken();
    const expiresAtMs = nowMs() + pairingTtlMs;

    if (!existingDevice) {
      await pool.query(
        "INSERT INTO devices (device_id, device_token, created_at, retention_days) VALUES ($1, $2, NOW(), $3)",
        [resolvedDeviceId, resolvedDeviceToken, 30]
      );
    }

    await pool.query(
      "INSERT INTO pairing_tokens (token, device_id, expires_at) VALUES ($1, $2, $3)",
      [pairingToken, resolvedDeviceId, new Date(expiresAtMs)]
    );

    return {
      deviceId: resolvedDeviceId,
      deviceToken: resolvedDeviceToken,
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

  const saveSnapshot = async ({ deviceId, agentStates, sessionSummary, ts } = {}) => {
    if (!deviceId) {
      return;
    }

    const timestamp = ts ? new Date(ts) : new Date();

    await pool.query(
      "INSERT INTO snapshots (device_id, agent_states, session_summary, ts) VALUES ($1, $2, $3, $4) ON CONFLICT (device_id) DO UPDATE SET agent_states = $2, session_summary = $3, ts = $4",
      [deviceId, agentStates ?? [], sessionSummary ?? null, timestamp]
    );
  };

  const appendEvent = async ({ deviceId, eventType, severity, payload, ts } = {}) => {
    if (!deviceId || !eventType) {
      return;
    }

    const timestamp = ts ? new Date(ts) : new Date();

    await pool.query(
      "INSERT INTO events (device_id, event_type, severity, payload, ts) VALUES ($1, $2, $3, $4, $5)",
      [deviceId, eventType, severity ?? "info", payload ?? {}, timestamp]
    );
  };

  return {
    cleanupExpiredTokens,
    createPairingRequest,
    confirmPairing,
    validateDevice,
    validateViewer,
    saveSnapshot,
    appendEvent,
    kind: "postgres",
  };
};

export const createStorage = async () => {
  if (!config.databaseUrl) {
    return createInMemoryStorage();
  }

  return createPostgresStorage();
};
