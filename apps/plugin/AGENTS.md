# PLUGIN KNOWLEDGE BASE

## OVERVIEW
OpenCode desktop plugin stub that holds live agent/session state and streams it to the relay.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| State shape | src/index.js | `agents`, `sessionSummary`, `events` |
| Hook adapter | src/index.js | `handleHook`, `attachHooks` |
| Relay WS client | src/index.js | `createRelayClient()` (connect/reconnect/logging) |
| Relay client tests | tests/relay-client.test.js | Fake WebSocket + reconnect/log throttling |

## CONVENTIONS
- Keep state keys aligned with relay payloads (`agents`, `sessionSummary`, `events`).
- ESM modules with explicit `.js` extensions.
- Treat relay downtime as expected: reconnect w/ backoff, avoid error-level spam.
- Prefer professional, well-maintained packages over rolling custom implementations; adding a dependency is OK when it materially improves correctness/maintainability.

## ANTI-PATTERNS
- Avoid adding inbound network listeners; plugin is outbound-only.
- Do not change state keys without updating relay expectations.

## NOTES
- Hook adapter supports either callback hooks (`onEvent`, `onSessionCreate`, etc.) or emitter-style `hooks.on(type, handler)`.
- Event types map to `snapshot.update` or `event.append` payloads in relay.
- Relay client uses exponential backoff + jitter (configurable via `createRelayClient()` options) and throttles disconnect/error logs.

## COMMANDS
```bash
npm --prefix apps/plugin run dev
npm --prefix apps/plugin run test
```
