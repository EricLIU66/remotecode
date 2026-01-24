# PLUGIN KNOWLEDGE BASE

## OVERVIEW
OpenCode desktop plugin stub that holds live agent/session state.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| State shape | src/index.js | `agents`, `sessionSummary`, `events` |
| Hook adapter | src/index.js | `handleHook`, `attachHooks` |

## CONVENTIONS
- Keep state keys aligned with relay payloads (`agents`, `sessionSummary`, `events`).
- ESM modules with explicit `.js` extensions.

## ANTI-PATTERNS
- Avoid adding inbound network listeners; plugin is outbound-only.
- Do not change state keys without updating relay expectations.

## NOTES
- Hook adapter supports either callback hooks (`onEvent`, `onSessionCreate`, etc.) or emitter-style `hooks.on(type, handler)`.
- Event types map to `snapshot.update` or `event.append` payloads in relay.
