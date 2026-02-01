# FRONTEND KNOWLEDGE BASE

## OVERVIEW
Vue 3 + Vite single-page status dashboard for the RemoteCode relay.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Main UI | src/App.vue | Relay URL input + polling + status display |
| Global styles | src/style.css | Typography, layout, status tones |
| Vite entry | src/main.js | Mounts the app |
| Build config | vite.config.js | Default Vite config |

## CONVENTIONS
- Keep dependencies minimal (no UI frameworks) and use plain CSS.
- When functionality is non-trivial (markdown rendering, syntax highlighting, diff viewers, etc.), prefer professional, well-maintained packages over rolling custom implementations.
- Persist relay URL in `localStorage` (key: `remotecode.relay_url`).
- Prefer read-only, privacy-safe surfaces (no command execution).

## ENDPOINTS
- Polls `GET {relay_url}/health` (expects `{ "status": "ok" }`).

## COMMANDS
```bash
npm --prefix apps/frontend install
npm --prefix apps/frontend run dev
npm --prefix apps/frontend run build
```

## NOTES
- Cross-origin calls to the relay health endpoint are allowed by the relay (CORS header on `/health`).
