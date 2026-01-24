import assert from "node:assert/strict";
import test from "node:test";
import { redactMessage, redactObject } from "../src/redaction.js";

test("redactObject redacts sensitive keys", () => {
  const input = {
    token: "abc",
    nested: { api_key: "123", password: "pw", ok: "yes" },
    list: [{ secret: "x", value: 1 }],
  };

  assert.deepEqual(redactObject(input), {
    token: "[redacted]",
    nested: { api_key: "[redacted]", password: "[redacted]", ok: "yes" },
    list: [{ secret: "[redacted]", value: 1 }],
  });
});

test("redactMessage applies redaction to fields", () => {
  const message = {
    type: "snapshot.update",
    agent_states: [{ name: "agent", token: "tok" }],
    session_summary: { secret: "super" },
    payload: { api_key: "key", other: 2 },
    other: "keep",
  };

  const output = redactMessage(message);

  assert.equal(output.other, "keep");
  assert.equal(output.agent_states[0].token, "[redacted]");
  assert.equal(output.session_summary.secret, "[redacted]");
  assert.equal(output.payload.api_key, "[redacted]");
  assert.equal(output.payload.other, 2);
});
