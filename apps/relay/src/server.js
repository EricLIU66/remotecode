import Fastify from "fastify";
import { WebSocketServer } from "ws";
import { pathToFileURL } from "node:url";
import { config } from "./config.js";
import { createStorage } from "./storage.js";
import { redactMessage } from "./redaction.js";

export const summarizePayload = (payload) => {
  if (payload === null || payload === undefined) {
    return { payloadType: payload === null ? "null" : "undefined" };
  }

  if (Array.isArray(payload)) {
    return { payloadType: "array", payloadCount: payload.length };
  }

  if (typeof payload !== "object") {
    return { payloadType: typeof payload };
  }

  const keys = Object.keys(payload);
  const previewKeys = [
    "type",
    "id",
    "name",
    "status",
    "agent_id",
    "agentId",
    "session_id",
    "sessionId",
    "tool",
    "tool_name",
    "toolName",
    "command",
    "message",
    "title",
  ];

  const preview = Object.fromEntries(
    previewKeys
      .filter((key) => payload[key] !== undefined)
      .slice(0, 6)
      .map((key) => [key, payload[key]])
  );

  return {
    payloadType: "object",
    payloadKeys: keys.slice(0, 12),
    payloadKeyCount: keys.length,
    payloadPreview: Object.keys(preview).length > 0 ? preview : undefined,
  };
};

const fastify = Fastify({ logger: true });
const cleanupIntervalMs = config.tokenCleanupIntervalMs;

const getClientIp = (request) => {
  const forwardedFor = request?.headers?.["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0].trim();
  }

  return request?.socket?.remoteAddress ?? null;
};

const parseRequestInfo = (request) => {
  const requestUrl = request.url ?? "/";
  const url = new URL(requestUrl, "http://localhost");
  return { path: url.pathname, searchParams: url.searchParams };
};

const applyCors = (reply) => {
  reply.header("access-control-allow-origin", "*");
  reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
  reply.header("access-control-allow-headers", "content-type");
};

const rejectUpgrade = (socket, statusCode, payload) => {
  const statusText =
    statusCode === 400
      ? "Bad Request"
      : statusCode === 401
        ? "Unauthorized"
        : statusCode === 403
          ? "Forbidden"
          : "Error";
  const body = JSON.stringify(payload ?? { error: "upgrade_rejected" });
  const length =
    typeof Buffer !== "undefined" && typeof Buffer.byteLength === "function"
      ? Buffer.byteLength(body)
      : body.length;

  try {
    socket.write(
      `HTTP/1.1 ${statusCode} ${statusText}\r\n` +
        "Connection: close\r\n" +
        "Content-Type: application/json; charset=utf-8\r\n" +
        `Content-Length: ${length}\r\n` +
        "\r\n" +
        body
    );
    socket.end();
  } catch {
    // Ignore write failures; best-effort response for handshake debugging.
    socket.destroy();
  }
};

fastify.get("/health", async (_request, reply) => {
  applyCors(reply);
  return { status: "ok" };
});

fastify.options("/pairing/request", async (_request, reply) => {
  applyCors(reply);
  return reply.status(204).send();
});

fastify.options("/pairing/confirm", async (_request, reply) => {
  applyCors(reply);
  return reply.status(204).send();
});

const start = async () => {
  const storage = await createStorage();

  const cleanupTimer = setInterval(() => {
    void storage.cleanupExpiredTokens();
  }, cleanupIntervalMs);
  cleanupTimer.unref?.();

  fastify.post(
    "/pairing/request",
    {
      schema: {
        body: {
          type: "object",
          properties: {
            device_id: { type: "string" },
            device_token: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      applyCors(reply);
      const { device_id: deviceId, device_token: deviceToken } = request.body ?? {};
      const { deviceId: resolvedDeviceId, deviceToken: resolvedDeviceToken, pairingToken, expiresAtMs } =
        await storage.createPairingRequest({ deviceId, deviceToken });

      return {
        device_id: resolvedDeviceId,
        device_token: resolvedDeviceToken,
        pairing_token: pairingToken,
        expires_at: new Date(expiresAtMs).toISOString(),
      };
    }
  );

  fastify.post(
    "/pairing/confirm",
    {
      schema: {
        body: {
          type: "object",
          required: ["pairing_token"],
          properties: {
            pairing_token: { type: "string" },
          },
          additionalProperties: false,
        },
      },
    },
    async (request, reply) => {
      applyCors(reply);
      const { pairing_token: pairingToken } = request.body ?? {};

      if (!pairingToken || typeof pairingToken !== "string") {
        return reply.status(400).send({ error: "pairing_token_required" });
      }

      const confirmation = await storage.confirmPairing(pairingToken);
      if (!confirmation) {
        return reply.status(400).send({ error: "pairing_token_invalid" });
      }

      return {
        viewer_token: confirmation.viewerToken,
        device_id: confirmation.deviceId,
      };
    }
  );

  const wsServer = new WebSocketServer({ noServer: true });
  const viewerConnections = new Map();

  const lastSnapshotLogAtMs = new Map();
  const snapshotLogIntervalMs = 5000;

  const broadcastToViewers = (deviceId, message) => {
    const connections = viewerConnections.get(deviceId);
    if (!connections || connections.size === 0) {
      return;
    }

    const payload = JSON.stringify(message);
    for (const socket of connections) {
      if (socket.readyState === 1) {
        socket.send(payload);
      }
    }
  };

  const handleDeviceMessage = async ({ deviceId, ip, data } = {}) => {
    let message = null;

    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      fastify.log.warn({ error }, "device_message_parse_failed");
      return;
    }

    if (!message || typeof message !== "object") {
      return;
    }

    if (message.device_id && message.device_id !== deviceId) {
      fastify.log.warn(
        { deviceId, messageDeviceId: message.device_id },
        "device_message_mismatch"
      );
      return;
    }

    const sanitizedMessage = redactMessage(message);

    try {
      if (sanitizedMessage.type === "snapshot.update") {
        const now = Date.now();
        const lastLog = lastSnapshotLogAtMs.get(deviceId) ?? 0;
        if (now - lastLog >= snapshotLogIntervalMs) {
          lastSnapshotLogAtMs.set(deviceId, now);
          fastify.log.info(
            {
              deviceId,
              ip,
              agentCount: Array.isArray(sanitizedMessage.agent_states)
                ? sanitizedMessage.agent_states.length
                : 0,
              hasSessionSummary: sanitizedMessage.session_summary !== null,
              ts: sanitizedMessage.ts,
            },
            "snapshot_received"
          );
        }

        await storage.saveSnapshot({
          deviceId,
          agentStates: sanitizedMessage.agent_states ?? [],
          sessionSummary: sanitizedMessage.session_summary ?? null,
          ts: sanitizedMessage.ts,
        });
        broadcastToViewers(deviceId, sanitizedMessage);
        return;
      }

      if (sanitizedMessage.type === "event.append") {
        const payloadSummary = summarizePayload(sanitizedMessage.payload);
        fastify.log.info(
          {
            deviceId,
            ip,
            eventType: sanitizedMessage.event_type,
            severity: sanitizedMessage.severity,
            ts: sanitizedMessage.ts,
            ...payloadSummary,
          },
          "event_received"
        );

        await storage.appendEvent({
          deviceId,
          eventType: sanitizedMessage.event_type,
          severity: sanitizedMessage.severity,
          payload: sanitizedMessage.payload,
          ts: sanitizedMessage.ts,
        });
        broadcastToViewers(deviceId, sanitizedMessage);
      }
    } catch (error) {
      fastify.log.error(
        { error, deviceId, messageType: sanitizedMessage?.type },
        "device_message_storage_failed"
      );
    }
  };

  wsServer.on("connection", async (socket, request) => {
    const { path, searchParams } = parseRequestInfo(request);

    socket.on("error", (error) => {
      fastify.log.warn({ error }, "ws_socket_error");
    });

    if (path === "/ws/device") {
      const deviceId = searchParams.get("device_id");
      const ip = getClientIp(request);
      fastify.log.info({ deviceId, ip }, "device_ws_connected");
      socket.on("message", (data) => {
        void handleDeviceMessage({ deviceId, ip, data });
      });
      socket.send(JSON.stringify({ type: "device.hello", device_id: deviceId }));
      return;
    }

    if (path === "/ws/viewer") {
      const viewerToken = searchParams.get("viewer_token");
      const deviceId = viewerToken
        ? await storage.validateViewer(viewerToken)
        : null;

      socket.send(
        JSON.stringify({
          type: "viewer.hello",
          device_id: deviceId,
        })
      );

      if (deviceId) {
        const connections = viewerConnections.get(deviceId) ?? new Set();
        connections.add(socket);
        viewerConnections.set(deviceId, connections);
        socket.on("close", () => {
          const active = viewerConnections.get(deviceId);
          if (!active) {
            return;
          }
          active.delete(socket);
          if (active.size === 0) {
            viewerConnections.delete(deviceId);
          }
        });
      }
      return;
    }

    socket.close();
  });

  fastify.server.on("upgrade", (request, socket, head) => {
    socket.on("error", (error) => {
      fastify.log.warn({ error }, "upgrade_socket_error");
    });
    void (async () => {
      const { path, searchParams } = parseRequestInfo(request);

      if (path === "/ws/device") {
        const deviceId = searchParams.get("device_id");
        const deviceToken = searchParams.get("device_token");

        if (!deviceId) {
          rejectUpgrade(socket, 400, { error: "device_id_required" });
          return;
        }

        const isValid =
          deviceToken && deviceToken.length > 0
            ? await storage.validateDevice(deviceId, deviceToken)
            : false;

        if (!isValid && !config.allowUnpairedDeviceWs) {
          rejectUpgrade(socket, 401, { error: "device_token_invalid" });
          return;
        }

        if (!isValid && config.allowUnpairedDeviceWs) {
          fastify.log.warn(
            { deviceId, ip: getClientIp(request) },
            "device_ws_unpaired_allowed"
          );
        }

        wsServer.handleUpgrade(request, socket, head, (ws) => {
          wsServer.emit("connection", ws, request);
        });
        return;
      }

      if (path === "/ws/viewer") {
        const viewerToken = searchParams.get("viewer_token");
        if (!viewerToken) {
          rejectUpgrade(socket, 400, { error: "viewer_token_required" });
          return;
        }
        const deviceId = viewerToken
          ? await storage.validateViewer(viewerToken)
          : null;

        if (!deviceId) {
          rejectUpgrade(socket, 401, { error: "viewer_token_invalid" });
          return;
        }

        wsServer.handleUpgrade(request, socket, head, (ws) => {
          wsServer.emit("connection", ws, request);
        });
        return;
      }

      socket.destroy();
    })();
  });

  await fastify.listen({ host: config.host, port: config.port });
};

const isMain =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  start();
}
