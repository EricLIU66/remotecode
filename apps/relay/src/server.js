import Fastify from "fastify";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { createStorage } from "./storage.js";

const fastify = Fastify({ logger: true });

const parseRequestInfo = (request) => {
  const requestUrl = request.url ?? "/";
  const url = new URL(requestUrl, "http://localhost");
  return { path: url.pathname, searchParams: url.searchParams };
};

fastify.get("/health", async () => ({ status: "ok" }));

const start = async () => {
  const storage = await createStorage();

  fastify.post("/pairing/request", async () => {
    const { deviceId, deviceToken, pairingToken, expiresAtMs } =
      await storage.createPairingRequest();

    return {
      device_id: deviceId,
      device_token: deviceToken,
      pairing_token: pairingToken,
      expires_at: new Date(expiresAtMs).toISOString(),
      storage: storage.kind,
    };
  });

  fastify.post("/pairing/confirm", async (request, reply) => {
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
  });

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
