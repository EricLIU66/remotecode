import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const loadEnvFile = (envPath = path.resolve(process.cwd(), ".env")) => {
  if (!fs.existsSync(envPath)) {
    return;
  }

  const contents = fs.readFileSync(envPath, "utf8");
  const lines = contents.split(/\r?\n/);

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      return;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (!key) {
      return;
    }

    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  });
};

const defaultRelayUrl = "http://localhost:8787";
const defaultSnapshotDebounceMs = 250;
const defaultReconnectDelayMs = 10_000;
const maxRecentEvents = 200;

export const pluginState = {
  agents: [],
  sessionSummary: null,
  events: [],
};

const redactKeyPattern = /(token|secret|password|api[_-]?key)/i;

const extractAgents = (payload) => {
  if (!payload) {
    return null;
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  if (Array.isArray(payload.agents)) {
    return payload.agents;
  }

  if (Array.isArray(payload.agent_states)) {
    return payload.agent_states;
  }

  if (Array.isArray(payload.agentStates)) {
    return payload.agentStates;
  }

  return null;
};

const extractSessionSummary = (payload) => {
  if (!payload) {
    return null;
  }

  if (payload.session_summary !== undefined) {
    return payload.session_summary;
  }

  if (payload.sessionSummary !== undefined) {
    return payload.sessionSummary;
  }

  if (payload.summary !== undefined) {
    return payload.summary;
  }

  return payload;
};

const redactObject = (value, key) => {
  if (key && redactKeyPattern.test(key)) {
    return "[redacted]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactObject(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactObject(childValue, childKey),
      ])
    );
  }

  return value;
};

const buildSnapshotMessage = (deviceId) => ({
  type: "snapshot.update",
  device_id: deviceId,
  agent_states: redactObject(pluginState.agents),
  session_summary: redactObject(pluginState.sessionSummary),
  ts: new Date().toISOString(),
});

const buildEventMessage = (deviceId, event) => ({
  type: "event.append",
  device_id: deviceId,
  event_type: event.event_type,
  severity: event.severity,
  payload: event.payload,
  ts: event.ts,
});

const buildDeviceWsUrl = (relayUrl, deviceId, deviceToken) => {
  const url = new URL(relayUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws/device";
  url.searchParams.set("device_id", deviceId);

  if (deviceToken) {
    url.searchParams.set("device_token", deviceToken);
  }

  return url.toString();
};

const buildPairingPayload = ({ relayUrl, deviceId, pairingToken }) =>
  JSON.stringify({
    relay_url: relayUrl,
    device_id: deviceId,
    pairing_token: pairingToken,
  });

const renderPairingQr = async ({
  relayUrl,
  deviceId,
  pairingToken,
  expiresAt,
  logger,
  QRCodeImpl,
}) => {
  if (!pairingToken || !QRCodeImpl) {
    return;
  }

  const payload = buildPairingPayload({ relayUrl, deviceId, pairingToken });

  try {
    const qr = await QRCodeImpl.toString(payload, {
      type: "terminal",
      errorCorrectionLevel: "M",
    });
    if (expiresAt) {
      logger.info?.("pairing_qr_expires_at", expiresAt);
    }
    logger.info?.(`\n${qr}`);
  } catch (error) {
    logger.warn?.("pairing_qr_failed", error);
  }
};

export const requestPairing = async ({ relayUrl, deviceId, deviceToken }) => {
  const url = new URL("/pairing/request", relayUrl);
  const payload = {};

  if (deviceId) {
    payload.device_id = deviceId;
  }

  if (deviceToken) {
    payload.device_token = deviceToken;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Pairing request failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  return {
    deviceId: data.device_id,
    deviceToken: data.device_token,
    pairingToken: data.pairing_token,
    expiresAt: data.expires_at,
  };
};

export const createRelayClient = ({
  relayUrl,
  deviceId,
  deviceToken,
  logger,
  reconnectDelayMs = defaultReconnectDelayMs,
  maxReconnectDelayMs = 10_000,
  reconnectBackoffFactor = 1,
  reconnectJitterRatio = 0,
  logThrottleMs = 30_000,
  onOpen,
  onAuthError,
  WebSocketImpl,
  now = () => Date.now(),
  random = () => Math.random(),
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) => {
  let socket = null;
  let reconnectTimer = null;
  let isConnecting = false;
  let shouldReconnect = true;
  let reconnectAttempt = 0;
  let hasEverConnected = false;
  let lastConnectionLogAt = 0;
  let lastWsUrl = null;

  const emitLog = (level, message, details) => {
    const target =
      logger?.[level] ??
      (level === "warn" ? logger?.info : null) ??
      (level === "debug" ? logger?.info : null) ??
      logger?.log;

    target?.(message, details);
  };

  const serializeError = (error) => {
    if (!error) {
      return null;
    }

    if (typeof error === "string") {
      return { message: error };
    }

    const maybeError = error?.error ?? error;
    const message = maybeError?.message ?? maybeError?.toString?.();
    const code = maybeError?.code;
    const name = maybeError?.name;
    return { message, code, name };
  };

  const extractStatusCode = (error) => {
    const message = error?.message ?? error?.toString?.() ?? "";
    const match = String(message).match(/\b(\d{3})\b/);
    if (!match) {
      return null;
    }
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
  };

  const normalizeCloseInfo = (codeOrEvent, reason) => {
    if (typeof codeOrEvent === "number") {
      const reasonText =
        typeof reason === "string"
          ? reason
          : typeof Buffer !== "undefined" && Buffer.isBuffer?.(reason)
            ? reason.toString()
            : reason?.toString?.();
      return { code: codeOrEvent, reason: reasonText };
    }

    if (codeOrEvent && typeof codeOrEvent === "object") {
      return {
        code: codeOrEvent.code,
        reason: codeOrEvent.reason,
        wasClean: codeOrEvent.wasClean,
      };
    }

    return {};
  };

  const maybeLogConnectionIssue = ({ event, details, forceLevel } = {}) => {
    if (!logger) {
      return;
    }

    const ts = now();
    if (logThrottleMs > 0 && ts - lastConnectionLogAt < logThrottleMs) {
      return;
    }

    lastConnectionLogAt = ts;
    const level = forceLevel ?? (hasEverConnected ? "warn" : "debug");
    emitLog(level, event, details);
  };

  const computeReconnectDelayMs = (attempt) => {
    const base = reconnectDelayMs * Math.pow(reconnectBackoffFactor, Math.max(0, attempt - 1));
    const capped = Math.min(maxReconnectDelayMs, base);
    const jitter = capped * reconnectJitterRatio;
    const min = Math.max(0, capped - jitter);
    const max = capped + jitter;
    return Math.round(min + (max - min) * random());
  };

  const scheduleReconnect = (meta = {}) => {
    if (reconnectTimer || !shouldReconnect) {
      return;
    }

    const attempt = reconnectAttempt + 1;
    reconnectAttempt = attempt;
    const delayMs = computeReconnectDelayMs(attempt);

    maybeLogConnectionIssue({
      event: "relay:disconnected",
      details: {
        attempt,
        delay_ms: delayMs,
        close: meta.close,
        error: meta.error,
      },
    });

    reconnectTimer = setTimeoutImpl(() => {
      reconnectTimer = null;
      connect();
    }, delayMs);
  };

  const clearConnection = (connection) => {
    if (socket === connection) {
      socket = null;
    }
    isConnecting = false;
  };

  const sendMessage = (message) => {
    const WebSocketRuntime = WebSocketImpl ?? globalThis.WebSocket;

    if (!socket || !WebSocketRuntime || socket.readyState !== WebSocketRuntime.OPEN) {
      return false;
    }

    socket.send(JSON.stringify(message));
    return true;
  };

  const connect = () => {
    if (isConnecting || socket) {
      return;
    }

    const WebSocketRuntime = WebSocketImpl ?? globalThis.WebSocket;

    if (!WebSocketRuntime) {
      throw new Error("WebSocket runtime not available");
    }

    isConnecting = true;
    const wsUrl = buildDeviceWsUrl(relayUrl, deviceId, deviceToken);
    lastWsUrl = wsUrl;
    const connection = new WebSocketRuntime(wsUrl);
    socket = connection;

    const addListener = (event, handler) => {
      if (typeof connection.on === "function") {
        connection.on(event, handler);
        return;
      }

      if (typeof connection.addEventListener === "function") {
        connection.addEventListener(event, handler);
        return;
      }

      const handlerKey = `on${event}`;
      if (handlerKey in connection) {
        connection[handlerKey] = handler;
        return;
      }

      throw new Error("WebSocket runtime does not support event listeners");
    };

    const normalizeMessageData = (data) => {
      const payload = data?.data ?? data;
      if (typeof payload === "string") {
        return payload;
      }

      if (typeof Buffer !== "undefined") {
        if (Buffer.isBuffer?.(payload)) {
          return payload.toString();
        }

        if (payload instanceof ArrayBuffer) {
          return Buffer.from(payload).toString();
        }

        if (ArrayBuffer.isView(payload)) {
          return Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength).toString();
        }
      }

      return payload?.toString?.() ?? "";
    };

    addListener("open", () => {
      isConnecting = false;
      reconnectAttempt = 0;
      hasEverConnected = true;
      lastConnectionLogAt = 0;
      emitLog("info", "relay:connected", { device_id: deviceId });
      onOpen?.();
    });

    addListener("message", (data) => {
      try {
        const messageText = normalizeMessageData(data);
        const message = JSON.parse(messageText);
        logger?.debug?.("relay:message", message);
      } catch (error) {
        logger?.warn?.("relay:message_parse_failed", error);
      }
    });

    addListener("close", (codeOrEvent, reason) => {
      const close = normalizeCloseInfo(codeOrEvent, reason);
      clearConnection(connection);
      scheduleReconnect({ close });
    });

    addListener("error", (error) => {
      const statusCode = extractStatusCode(error);
      if (statusCode === 401 || statusCode === 403) {
        shouldReconnect = false;
        clearConnection(connection);
        void onAuthError?.({
          statusCode,
          wsUrl: lastWsUrl,
          error: serializeError(error),
        });
        return;
      }

      maybeLogConnectionIssue({
        event: "relay:connection_error",
        details: { attempt: reconnectAttempt + 1, error: serializeError(error) },
        forceLevel: hasEverConnected ? "warn" : "debug",
      });
      clearConnection(connection);
      scheduleReconnect({ error: serializeError(error) });
    });
  };

  const close = () => {
    shouldReconnect = false;
    if (reconnectTimer) {
      clearTimeoutImpl(reconnectTimer);
      reconnectTimer = null;
    }

    socket?.close();
    socket = null;
  };

  return {
    connect,
    close,
    sendSnapshot: () => sendMessage(buildSnapshotMessage(deviceId)),
    sendEvent: (event) => sendMessage(buildEventMessage(deviceId, event)),
  };
};

export const createPlugin = ({
  relayUrl = process.env.RELAY_URL ?? defaultRelayUrl,
  deviceId = process.env.DEVICE_ID ?? null,
  deviceToken = process.env.DEVICE_TOKEN ?? null,
  allowUnpaired =
    process.env.REMOTECODE_UNPAIRED === "1" ||
    process.env.REMOTECODE_UNPAIRED === "true" ||
    process.env.ALLOW_UNPAIRED_DEVICE_WS === "1" ||
    process.env.ALLOW_UNPAIRED_DEVICE_WS === "true",
  snapshotDebounceMs = defaultSnapshotDebounceMs,
  logger = console,
  hooks = null,
  dependencies = {},
} = {}) => {
  let relayClient = null;
  let snapshotTimer = null;
  let currentDeviceId = deviceId;
  let currentDeviceToken = deviceToken;
  let detachHooks = null;
  let authRepairPromise = null;

  const tryPersistDeviceCredentials = ({ nextDeviceId, nextDeviceToken } = {}) => {
    const configPath =
      process.env.REMOTECODE_CONFIG_PATH ??
      path.resolve(process.cwd(), ".opencode", "remotecode.json");

    if (!nextDeviceId || !nextDeviceToken) {
      return;
    }

    if (!fs.existsSync(configPath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(configPath, "utf8");
      const existing = JSON.parse(raw);
      if (!existing || typeof existing !== "object") {
        return;
      }

      const nextConfig = {
        ...existing,
        relay_url: existing.relay_url ?? relayUrl,
        device_id: nextDeviceId,
        device_token: nextDeviceToken,
      };

      fs.writeFileSync(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
      logger.info?.("remotecode_config_updated", { path: configPath });
    } catch (error) {
      logger.warn?.("remotecode_config_update_failed", {
        path: configPath,
        error: error?.message ?? error,
      });
    }
  };

  const repairAuth = ({ statusCode, wsUrl, error } = {}) => {
    if (authRepairPromise) {
      return authRepairPromise;
    }

    authRepairPromise = (async () => {
      logger.warn?.("relay:auth_failed_repairing", {
        status_code: statusCode,
        ws_url: wsUrl,
        error,
      });

      relayClient?.close();
      relayClient = null;

      const pairing = await requestPairing({
        relayUrl,
        deviceId: currentDeviceId,
        deviceToken: currentDeviceToken,
      });

      currentDeviceId = pairing.deviceId;
      currentDeviceToken = pairing.deviceToken;
      tryPersistDeviceCredentials({
        nextDeviceId: currentDeviceId,
        nextDeviceToken: currentDeviceToken,
      });

      if (pairing.pairingToken) {
        logger.info?.("pairing_token_received", { expires_at: pairing.expiresAt });
        await renderPairingQr({
          relayUrl,
          deviceId: pairing.deviceId,
          pairingToken: pairing.pairingToken,
          expiresAt: pairing.expiresAt,
          logger,
          QRCodeImpl: dependencies.QRCode,
        });
      }

      relayClient = createRelayClient({
        relayUrl,
        deviceId: currentDeviceId,
        deviceToken: currentDeviceToken,
        logger,
        onOpen: sendSnapshot,
        WebSocketImpl: dependencies.WebSocket,
        onAuthError: (meta) => {
          void repairAuth(meta);
        },
      });

      relayClient.connect();
    })().finally(() => {
      authRepairPromise = null;
    });

    return authRepairPromise;
  };

  const sendSnapshot = () => {
    if (!relayClient || !currentDeviceId) {
      return;
    }

    relayClient.sendSnapshot();
  };

  const scheduleSnapshot = () => {
    if (snapshotTimer) {
      return;
    }

    snapshotTimer = setTimeout(() => {
      snapshotTimer = null;
      sendSnapshot();
    }, snapshotDebounceMs);
  };

  const connect = async () => {
    if (!relayUrl) {
      throw new Error("RELAY_URL is required");
    }

    if (!currentDeviceId || !currentDeviceToken) {
      if (allowUnpaired) {
        if (!currentDeviceId) {
          currentDeviceId = crypto.randomUUID();
        }

        currentDeviceToken = currentDeviceToken || null;
      } else {
        const pairing = await requestPairing({
          relayUrl,
          deviceId: currentDeviceId,
          deviceToken: currentDeviceToken,
        });

        currentDeviceId = pairing.deviceId;
        currentDeviceToken = pairing.deviceToken;

        if (pairing.pairingToken) {
          logger.info?.("pairing_token_received", { expires_at: pairing.expiresAt });
          await renderPairingQr({
            relayUrl,
            deviceId: pairing.deviceId,
            pairingToken: pairing.pairingToken,
            expiresAt: pairing.expiresAt,
            logger,
            QRCodeImpl: dependencies.QRCode,
          });
        }
      }
    }

    relayClient = createRelayClient({
      relayUrl,
      deviceId: currentDeviceId,
      deviceToken: currentDeviceToken,
      logger,
      onOpen: sendSnapshot,
      WebSocketImpl: dependencies.WebSocket,
      onAuthError: (meta) => {
        void repairAuth(meta);
      },
    });

    relayClient.connect();
  };

  const updateAgents = (agents = []) => {
    pluginState.agents = redactObject(agents);
    scheduleSnapshot();
  };

  const updateSessionSummary = (summary) => {
    pluginState.sessionSummary = redactObject(summary);
    scheduleSnapshot();
  };

  const appendEvent = ({ eventType, severity = "info", payload } = {}) => {
    if (!eventType) {
      return;
    }

    const entry = {
      event_type: eventType,
      severity,
      payload: redactObject(payload),
      ts: new Date().toISOString(),
    };

    pluginState.events = [entry, ...pluginState.events].slice(0, maxRecentEvents);
    relayClient?.sendEvent(entry);
  };

  const handleHook = ({ type, payload, severity } = {}) => {
    if (!type) {
      return;
    }

    if (type === "event" && payload?.type) {
      handleHook(payload);
      return;
    }

    if (type === "agents.update") {
      const agents = extractAgents(payload);
      if (agents) {
        updateAgents(agents);
      }
      return;
    }

    if (type === "session.summary") {
      const summary = extractSessionSummary(payload);
      if (summary) {
        updateSessionSummary(summary);
      }
      return;
    }

    if (type === "session.create" || type === "session.complete") {
      const summary = extractSessionSummary(payload);
      if (summary) {
        updateSessionSummary(summary);
      }
      appendEvent({ eventType: type, severity: severity ?? "info", payload });
      return;
    }

    appendEvent({ eventType: type, severity: severity ?? "info", payload });
  };

  const attachHooks = (hookSet = hooks) => {
    if (!hookSet) {
      return () => {};
    }

    detachHooks?.();
    const unsubscribers = [];

    const recordUnsubscribe = (unsubscribe) => {
      if (typeof unsubscribe === "function") {
        unsubscribers.push(unsubscribe);
      }
    };

    const registerHook = (registerFn, handler) => {
      if (typeof registerFn !== "function") {
        return;
      }

      const unsubscribe = registerFn(handler);
      if (typeof unsubscribe === "function") {
        recordUnsubscribe(unsubscribe);
      }
    };

    const registerEmitter = (type) => {
      if (typeof hookSet.on !== "function") {
        return;
      }

      const handler = (payload) => handleHook({ type, payload });
      const unsubscribe = hookSet.on(type, handler);

      if (typeof unsubscribe === "function") {
        recordUnsubscribe(unsubscribe);
      } else if (typeof hookSet.off === "function") {
        recordUnsubscribe(() => hookSet.off(type, handler));
      }
    };

    registerHook(hookSet.onEvent, (event) => {
      if (event?.type) {
        handleHook(event);
      } else {
        handleHook({ type: "event", payload: event });
      }
    });
    registerHook(hookSet.onSessionCreate, (payload) =>
      handleHook({ type: "session.create", payload })
    );
    registerHook(hookSet.onSessionComplete, (payload) =>
      handleHook({ type: "session.complete", payload })
    );
    registerHook(hookSet.onToolExecuteBefore, (payload) =>
      handleHook({ type: "tool.execute.before", payload })
    );
    registerHook(hookSet.onToolExecuteAfter, (payload) =>
      handleHook({ type: "tool.execute.after", payload })
    );
    registerHook(hookSet.onChatMessage, (payload) =>
      handleHook({ type: "chat.message", payload })
    );
    registerHook(hookSet.onAgentsUpdate, (payload) =>
      handleHook({ type: "agents.update", payload })
    );
    registerHook(hookSet.onSessionSummary, (payload) =>
      handleHook({ type: "session.summary", payload })
    );

    [
      "event",
      "session.create",
      "session.complete",
      "tool.execute.before",
      "tool.execute.after",
      "chat.message",
      "agents.update",
      "session.summary",
    ].forEach(registerEmitter);

    detachHooks = () => {
      unsubscribers.forEach((unsubscribe) => {
        try {
          unsubscribe();
        } catch (error) {
          logger?.warn?.("hook_unsubscribe_failed", error);
        }
      });
      unsubscribers.length = 0;
    };

    return detachHooks;
  };

  if (hooks) {
    attachHooks(hooks);
  }

  return {
    connect,
    updateAgents,
    updateSessionSummary,
    appendEvent,
    handleHook,
    attachHooks,
    state: pluginState,
  };
};

const isDirectRun = () => {
  if (typeof process === "undefined" || !process.argv?.[1]) {
    return false;
  }

  const scriptHref = new URL(`file://${process.argv[1]}`).href;
  return import.meta.url === scriptHref;
};

if (isDirectRun()) {
  const scriptPath = fileURLToPath(import.meta.url);
  const scriptDir = path.dirname(scriptPath);

  loadEnvFile(path.resolve(scriptDir, "..", ".env"));

  const { WebSocket } = await import("ws");
  const QRCode = (await import("qrcode")).default;

  const plugin = createPlugin({
    dependencies: {
      WebSocket,
      QRCode,
    },
  });

  plugin.connect().catch((error) => {
    console.error("plugin_start_failed", error);
    process.exitCode = 1;
  });
}
