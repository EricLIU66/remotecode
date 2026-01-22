# AGENTS

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
