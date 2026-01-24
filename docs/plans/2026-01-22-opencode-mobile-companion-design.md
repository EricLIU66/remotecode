# OpenCode Mobile Companion Design (v1)

## Summary
Build a self-hosted cloud relay that connects an OpenCode plugin (desktop) to a SwiftUI iOS companion app. The phone displays a **view-only** status dashboard: agent list + state, current session summary, and recent tool events/logs. Connections are **WebSocket-based** with **QR pairing**, **device-only** auth (no user accounts), and **Postgres-backed** 30-day retention (configurable per device). Secrets are redacted; file contents are excluded by default.

## Goals
- View-only mobile dashboard (no command execution in v1)
- Live status updates over WebSocket
- QR-based pairing (device-only auth)
- Self-hosted relay with Postgres retention (default 30 days)
- Secret redaction and privacy controls

## Non-Goals (v1)
- Running commands from phone
- File contents streaming
- Push notifications
- Multi-user sharing / teams
- Advanced analytics or search

## Architecture Overview
Three-tier architecture with outbound connectivity from desktop to relay:

1. **OpenCode Plugin (Desktop)**
   - Hooks into OpenCode events and tool execution.
   - Maintains local state (agent list, current session summary, recent events).
   - Connects outbound to relay via WebSocket.
   - Generates QR pairing token.
   - Redacts secrets before sending.

2. **Relay (Node.js + Fastify + WebSocket + Postgres)**
   - Auth + pairing endpoints.
   - WebSocket hub for device streams and viewer subscriptions.
   - Stores snapshots and events in Postgres (retention policy).
   - Fan-out updates to subscribed viewers.

3. **iOS App (SwiftUI)**
   - QR scan → pairing.
   - Live dashboard via WebSocket.
   - REST fetch for latest snapshot + recent events on reconnect.

Data flow: plugin → relay (WS) → Postgres (store) + fan-out → iOS client (WS).

## Core Components
### Plugin
- Uses OpenCode plugin hooks: `event`, `session.create`, `session.complete`, `tool.execute.before`, `tool.execute.after`, `chat.message`.
- Emits two main message types:
  - **Status Snapshot**: agent states + current session summary.
  - **Event Append**: recent tool events/logs (structured metadata only).
- Redaction rules applied before emitting.

### Relay
- WebSocket endpoints:
  - `/ws/device` for plugin/device connections
  - `/ws/viewer` for iOS viewers
- REST endpoints:
  - `POST /pairing/request` (plugin) → `{ device_id, pairing_token, expires_at }`
  - `POST /pairing/confirm` (iOS) → `{ viewer_token, device_id }`
  - `GET /history?device_id&limit&since` (iOS)
  - `GET /snapshot/latest?device_id` (iOS)
- Storage:
  - Status snapshots and event logs in Postgres
  - Retention policy per device (default 30 days)

### iOS App
- QR scan pairing flow
- Live updates via WebSocket
- Fetch history on reconnect

## Security & Pairing
- **Device pairing only** (no user accounts).
- **QR-based** short-lived pairing token (e.g., 5 minutes).
- Plugin authenticates via **device key** stored locally.
- Viewer tokens are device-scoped, can be revoked/rotated.
- Secrets are redacted on **plugin and relay**.
- No file contents are sent by default.

## Data Model (Postgres)
- `devices`: device metadata, retention settings
- `device_connections`: connection history
- `snapshots`: latest status snapshots
- `events`: tool/event logs
- `pairing_tokens`: short-lived pairing tokens
- `viewer_tokens`: viewer auth tokens

## WebSocket Message Shapes
- `snapshot.update` → `{ device_id, agent_states, session_summary, ts }`
- `event.append` → `{ device_id, event_type, severity, payload, ts }`
- `device.hello` / `viewer.hello` for auth
- `ping/pong` for keepalive

## Retention & Privacy
- Default retention: 30 days (configurable per device)
- No file contents in v1
- Secret redaction: env vars, tokens, keys
- Optional future setting to include additional metadata

## Testing Strategy
- Relay unit tests: pairing, token issuance/expiry, retention
- Relay integration tests: WS fan-out, reconnect flows
- Plugin tests: redaction, message shaping, reconnect
- iOS tests: QR parsing, reconnect, rendering lists

## Rollout Plan (v1)
1. Implement relay (Fastify + WS + Postgres) with migrations
2. Implement OpenCode plugin with redaction and WS streaming
3. Build SwiftUI iOS app with QR pairing + dashboard
4. Provide docker-compose for self-hosted relay

## Open Questions (future)
- Allow per-device privacy configuration UI
- Add push notifications
- Add command execution from phone
