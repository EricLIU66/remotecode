import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { WebSocket } from "ws";

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

loadEnvFile();

const defaultRelayUrl = "http://localhost:8787";
const defaultSnapshotDebounceMs = 250;
const defaultReconnectDelayMs = 2000;
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
  url.searchParams.set("device_token", deviceToken);
  return url.toString();
};

const buildPairingPayload = ({ relayUrl, deviceId, pairingToken }) =>
  JSON.stringify({
    relay_url: relayUrl,
    device_id: deviceId,
    pairing_token: pairingToken,
  });

const renderPairingQr = async ({ relayUrl, deviceId, pairingToken, expiresAt, logger }) => {
  if (!pairingToken) {
    return;
  }

  const payload = buildPairingPayload({ relayUrl, deviceId, pairingToken });

  try {
    const qr = await QRCode.toString(payload, {
      type: "terminal",
      errorCorrectionLevel: "M",
    });
    logger.info?.("pairing_qr_payload", payload);
    if (expiresAt) {
      logger.info?.("pairing_qr_expires_at", expiresAt);
    }
    logger.info?.(`\n${qr}`);
  } catch (error) {
    logger.warn?.("pairing_qr_failed", error);
    logger.info?.("pairing_qr_payload", payload);
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
  onOpen,
} = {}) => {
  let socket = null;
  let reconnectTimer = null;
  let isConnecting = false;
  let shouldReconnect = true;

  const scheduleReconnect = () => {
    if (reconnectTimer || !shouldReconnect) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectDelayMs);
  };

  const sendMessage = (message) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    socket.send(JSON.stringify(message));
    return true;
  };

  const connect = () => {
    if (isConnecting || socket) {
      return;
    }

    isConnecting = true;
    const wsUrl = buildDeviceWsUrl(relayUrl, deviceId, deviceToken);
    const connection = new WebSocket(wsUrl);
    socket = connection;

    connection.on("open", () => {
      isConnecting = false;
      onOpen?.();
    });

    connection.on("message", (data) => {
      try {
        const message = JSON.parse(data.toString());
        logger?.debug?.("relay:message", message);
      } catch (error) {
        logger?.warn?.("relay:message_parse_failed", error);
      }
    });

    connection.on("close", () => {
      socket = null;
      isConnecting = false;
      scheduleReconnect();
    });

    connection.on("error", (error) => {
      logger?.error?.("relay:connection_error", error);
    });
  };

  const close = () => {
    shouldReconnect = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
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
  snapshotDebounceMs = defaultSnapshotDebounceMs,
  logger = console,
  hooks = null,
} = {}) => {
  let relayClient = null;
  let snapshotTimer = null;
  let currentDeviceId = deviceId;
  let currentDeviceToken = deviceToken;
  let detachHooks = null;

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
      const pairing = await requestPairing({
        relayUrl,
        deviceId: currentDeviceId,
        deviceToken: currentDeviceToken,
      });

      currentDeviceId = pairing.deviceId;
      currentDeviceToken = pairing.deviceToken;

      if (pairing.pairingToken) {
        logger.info?.("pairing_token", pairing.pairingToken, "expires_at", pairing.expiresAt);
        await renderPairingQr({
          relayUrl,
          deviceId: pairing.deviceId,
          pairingToken: pairing.pairingToken,
          expiresAt: pairing.expiresAt,
          logger,
        });
      }
    }

    relayClient = createRelayClient({
      relayUrl,
      deviceId: currentDeviceId,
      deviceToken: currentDeviceToken,
      logger,
      onOpen: sendSnapshot,
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
  if (!process.argv[1]) {
    return false;
  }

  return import.meta.url === new URL(`file://${process.argv[1]}`).href;
};

if (isDirectRun()) {
  const plugin = createPlugin();
  plugin.connect().catch((error) => {
    console.error("plugin_start_failed", error);
    process.exitCode = 1;
  });
}
