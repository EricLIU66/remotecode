# RELAY KNOWLEDGE BASE

## OVERVIEW
Fastify REST + WebSocket relay with optional Postgres-backed token storage.

## STRUCTURE
```
apps/relay/
├── src/
│   ├── server.js   # Fastify routes + WS upgrade/auth
│   ├── storage.js  # in-memory vs Postgres token logic
│   ├── config.js   # env defaults
│   └── migrate.js  # runs SQL migrations
├── migrations/
│   └── 001_init.sql
└── package.json
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Pairing endpoints | src/server.js | `/pairing/request`, `/pairing/confirm` |
| WS auth gating | src/server.js | `/ws/device` + `/ws/viewer` upgrades |
| Token TTL + cleanup | src/storage.js | 5-min pairing, 30-day viewer |
| Postgres schema | migrations/001_init.sql | devices + token tables |
| Env defaults | src/config.js | `HOST`, `PORT`, `DATABASE_URL` |

## CONVENTIONS
- ESM-only modules with explicit `.js` extensions.
- REST responses use snake_case keys.
- `DATABASE_URL` unset → in-memory storage.

## ANTI-PATTERNS
- Do not allow WS connections without token validation.
- Avoid cross-app refactors outside `apps/relay`.

## NOTES
- `npm run migrate` requires `DATABASE_URL`.
- `cleanupExpiredTokens` runs on `TOKEN_CLEANUP_INTERVAL_MS`.
