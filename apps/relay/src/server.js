import Fastify from "fastify";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { createStorage } from "./storage.js";

const fastify = Fastify({ logger: true });
const cleanupIntervalMs = 60 * 60 * 1000;

const parseRequestInfo = (request) => {
  const requestUrl = request.url ?? "/";
  const url = new URL(requestUrl, "http://localhost");
  return { path: url.pathname, searchParams: url.searchParams };
};

fastify.get("/health", async () => ({ status: "ok" }));

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
    async (request) => {
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

  wsServer.on("connection", async (socket, request) => {
    const { path, searchParams } = parseRequestInfo(request);

    if (path === "/ws/device") {
      const deviceId = searchParams.get("device_id");
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
      return;
    }

    socket.close();
  });

  fastify.server.on("upgrade", (request, socket, head) => {
    void (async () => {
      const { path, searchParams } = parseRequestInfo(request);

      if (path === "/ws/device") {
        const deviceId = searchParams.get("device_id");
        const deviceToken = searchParams.get("device_token");

        const isValid =
          deviceId && deviceToken
            ? await storage.validateDevice(deviceId, deviceToken)
            : false;

        if (!isValid) {
          socket.destroy();
          return;
        }

        wsServer.handleUpgrade(request, socket, head, (ws) => {
          wsServer.emit("connection", ws, request);
        });
        return;
      }

      if (path === "/ws/viewer") {
        const viewerToken = searchParams.get("viewer_token");
        const deviceId = viewerToken
          ? await storage.validateViewer(viewerToken)
          : null;

        if (!deviceId) {
          socket.destroy();
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

start();
