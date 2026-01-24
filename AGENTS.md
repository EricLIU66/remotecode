# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-24
**Commit:** 4c1441f
**Branch:** master

## OVERVIEW
RemoteCode is a self-hosted, view-only mobile companion for OpenCode: a desktop plugin streams state to a Fastify + WebSocket relay with Postgres storage, and an iOS app subscribes for live status.

## STRUCTURE
```
./
├── apps/relay/    # Fastify + WS relay + Postgres storage
├── apps/plugin/   # OpenCode plugin state stub
├── apps/ios/      # SwiftUI app placeholder
└── docs/plans/    # Architecture/design notes
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Pairing + WS auth | apps/relay/src/server.js | REST + WebSocket handshake paths |
| Token/storage logic | apps/relay/src/storage.js | in-memory + Postgres implementations |
| Relay configuration | apps/relay/src/config.js | env defaults + tuning |
| Database schema | apps/relay/migrations/001_init.sql | pairing/viewer/device tables |
| v1 product scope | docs/plans/2026-01-22-opencode-mobile-companion-design.md | goals + non-goals |

## CONVENTIONS
- Relay is ESM-only (`"type": "module"`), keep imports with `.js` extensions.
- REST payloads use snake_case keys (e.g., `device_id`, `pairing_token`).
- WebSocket paths are `/ws/device` and `/ws/viewer` with query tokens.
- No file contents in v1; secrets must be redacted before transmit.
- Desktop plugin never accepts inbound connections; only outbound to relay.

## ANTI-PATTERNS (THIS PROJECT)
- Do not add command execution or push notifications in v1.
- Do not stream raw stdout/logs or file contents by default.
- Avoid refactors that cross component boundaries (plugin/relay/iOS).

## UNIQUE STYLES
- Storage uses a 5-minute pairing TTL and 30-day viewer TTL in `apps/relay/src/storage.js`.
- Relay defaults to in-memory storage unless `DATABASE_URL` is set.

## COMMANDS
```bash
npm --prefix apps/relay run dev
npm --prefix apps/relay run migrate
npm --prefix apps/plugin run dev
```

## NOTES
- Relay token cleanup interval uses `TOKEN_CLEANUP_INTERVAL_MS` (default 1h).
- iOS app is not implemented yet; `.env`/`.gitkeep` only.

## Implementation Architecture
- **Three-tier system**: OpenCode plugin (desktop) → cloud relay → iOS app.
- **Connectivity**: Desktop plugin opens **outbound WebSocket** to relay; iOS connects to relay via WebSocket; REST used for pairing and history.
- **Relay stack**: Node.js (Fastify) + WebSocket + Postgres.
- **Storage**: Postgres stores latest snapshots + event logs with **30-day default retention** (per-device configurable).
- **Pairing**: QR-based, **device-only** pairing (no user accounts). Short-lived pairing token; viewer token issued for device-scoped access.
- **Privacy**: **No file contents** in v1; **secret redaction** in plugin and re-checked in relay.
- **Data shape**: `snapshot.update` (agent states + session summary), `event.append` (structured tool/event metadata).

## Implementation Principles
- **Security-first**: TLS everywhere, short-lived tokens, device-scoped auth; no inbound connections to desktop.
- **Minimal v1**: view-only dashboard, no command execution or push notifications.
- **Event-driven**: OpenCode plugin uses hooks for session/tool/event updates.
- **Small, focused changes**: avoid refactors outside scope.
- **No secret leakage**: redact before transmit, avoid raw stdout/logs unless explicitly permitted later.
- **Self-hosted first**: relay deployable via docker-compose; no managed service requirements.
- **Quality gates**: write needed unit tests, run format checks, run unit tests on every PR push.
- **Clean code**: tight, readable, production-grade implementation.
- **Component isolation**: keep components independent and modular for maintainability.

## Scope Boundaries (v1)
- **In**: agent list + state, current session summary, recent tool events/logs.
- **Out**: file contents, command execution, push notifications, team sharing.
