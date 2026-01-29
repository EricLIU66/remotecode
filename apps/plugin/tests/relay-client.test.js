import assert from "node:assert/strict";
import { test } from "node:test";
import { createRelayClient } from "../src/index.js";

class FakeWebSocket {
  static OPEN = 1;
  static lastInstance = null;

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.OPEN;
    this.listeners = new Map();
    FakeWebSocket.lastInstance = this;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  trigger(type, event) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.forEach((handler) => {
      handler(event);
    });
  }

  send(payload) {
    this.sent = payload;
  }

  close() {
    this.closed = true;
  }
}

test("relay client supports addEventListener WebSocket", () => {
  let opened = false;
  let warnCount = 0;
  let debugCount = 0;
  let errorCount = 0;

  const client = createRelayClient({
    relayUrl: "http://localhost:8787",
    deviceId: "device-1",
    deviceToken: "token-1",
    logger: {
      debug: () => {
        debugCount += 1;
      },
      warn: () => {
        warnCount += 1;
      },
      error: () => {
        errorCount += 1;
      },
    },
    onOpen: () => {
      opened = true;
    },
    WebSocketImpl: FakeWebSocket,
  });

  assert.doesNotThrow(() => client.connect());

  const socket = FakeWebSocket.lastInstance;
  assert.ok(socket, "expected websocket instance");

  socket.trigger("open");
  socket.trigger("message", { data: JSON.stringify({ hello: "world" }) });

  assert.equal(opened, true);
  assert.equal(warnCount, 0);
  assert.equal(debugCount, 1);
  assert.equal(errorCount, 0);
});

test("relay client logs disconnects without error-level spam", () => {
  let warnCount = 0;
  let debugCount = 0;
  let errorCount = 0;
  let scheduledDelayMs = null;

  const client = createRelayClient({
    relayUrl: "http://localhost:8787",
    deviceId: "device-1",
    deviceToken: "token-1",
    logger: {
      debug: () => {
        debugCount += 1;
      },
      warn: () => {
        warnCount += 1;
      },
      error: () => {
        errorCount += 1;
      },
    },
    WebSocketImpl: FakeWebSocket,
    logThrottleMs: 0,
    random: () => 0,
    setTimeoutImpl: (_fn, ms) => {
      scheduledDelayMs = ms;
      return 123;
    },
    clearTimeoutImpl: () => {},
  });

  client.connect();
  const socket = FakeWebSocket.lastInstance;
  assert.ok(socket, "expected websocket instance");

  socket.trigger("error", { code: "ECONNREFUSED", message: "connect ECONNREFUSED" });

  assert.equal(errorCount, 0);
  assert.ok(warnCount + debugCount >= 1, "expected non-error log");
  assert.ok(typeof scheduledDelayMs === "number" && scheduledDelayMs >= 0);
});

test("relay client throttles repeated connection logs", () => {
  let warnCount = 0;
  let debugCount = 0;
  let infoCount = 0;
  let nowValue = 1_000_000_000;

  const client = createRelayClient({
    relayUrl: "http://localhost:8787",
    deviceId: "device-1",
    deviceToken: "token-1",
    logger: {
      debug: () => {
        debugCount += 1;
      },
      warn: () => {
        warnCount += 1;
      },
      info: () => {
        infoCount += 1;
      },
    },
    WebSocketImpl: FakeWebSocket,
    logThrottleMs: 30_000,
    now: () => nowValue,
    random: () => 0,
    setTimeoutImpl: () => 123,
    clearTimeoutImpl: () => {},
  });

  client.connect();
  const socket = FakeWebSocket.lastInstance;
  assert.ok(socket, "expected websocket instance");

  socket.trigger("error", { code: "ECONNREFUSED", message: "connect ECONNREFUSED" });
  nowValue = 1_000_000_010;
  socket.trigger("error", { code: "ECONNREFUSED", message: "connect ECONNREFUSED" });

  assert.equal(infoCount, 0, "should not treat disconnect as info");
  assert.equal(warnCount + debugCount, 1, "expected throttled logging");
});

test("relay client reports auth errors without reconnecting", () => {
  let authMeta = null;
  let timeoutCount = 0;

  const client = createRelayClient({
    relayUrl: "http://localhost:8787",
    deviceId: "device-1",
    deviceToken: "token-1",
    logger: {
      warn: () => {},
      debug: () => {},
    },
    WebSocketImpl: FakeWebSocket,
    onAuthError: (meta) => {
      authMeta = meta;
    },
    setTimeoutImpl: () => {
      timeoutCount += 1;
      return 123;
    },
    clearTimeoutImpl: () => {},
  });

  client.connect();
  const socket = FakeWebSocket.lastInstance;
  assert.ok(socket, "expected websocket instance");

  socket.trigger("error", { message: "Unexpected server response: 401" });

  assert.ok(authMeta, "expected auth callback");
  assert.equal(authMeta.statusCode, 401);
  assert.equal(timeoutCount, 0, "should not schedule reconnect on auth error");
});
