import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizePayload } from "../src/server.js";

test("summarizePayload returns object key summary and preview", () => {
  const payload = {
    type: "tool.execute.after",
    session_id: "session-1",
    tool_name: "bash",
    status: "ok",
    message: "hello",
    title: "done",
    k1: 1,
    k2: 2,
    k3: 3,
    k4: 4,
    k5: 5,
    k6: 6,
    k7: 7,
    k8: 8,
    k9: 9,
  };

  const summary = summarizePayload(payload);
  assert.equal(summary.payloadType, "object");
  assert.equal(summary.payloadKeyCount, 15);
  assert.equal(summary.payloadKeys.length, 12);
  assert.deepEqual(summary.payloadPreview, {
    type: "tool.execute.after",
    status: "ok",
    session_id: "session-1",
    tool_name: "bash",
    message: "hello",
    title: "done",
  });
});

test("summarizePayload returns array count", () => {
  const summary = summarizePayload([1, 2, 3]);
  assert.deepEqual(summary, { payloadType: "array", payloadCount: 3 });
});

test("summarizePayload returns primitive type", () => {
  const summary = summarizePayload("hello");
  assert.deepEqual(summary, { payloadType: "string" });
});

test("summarizePayload omits preview when no preview keys", () => {
  const summary = summarizePayload({ a: 1, b: 2 });
  assert.equal(summary.payloadType, "object");
  assert.equal(summary.payloadKeyCount, 2);
  assert.equal(summary.payloadPreview, undefined);
});
