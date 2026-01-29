# RemoteCode Frontend (Vue)

Minimal Vue 3 dashboard for checking relay availability.

## Dev
Start the relay:
`npm --prefix apps/relay run dev`

Start the web UI:
`npm --prefix apps/frontend run dev`

Then open the URL Vite prints (default `http://localhost:5173`).

## Config
The UI polls `GET {relay_url}/health`.

- Default relay URL: `http://localhost:8787`
- Override at build time: `VITE_RELAY_URL=http://your-relay:8787`
