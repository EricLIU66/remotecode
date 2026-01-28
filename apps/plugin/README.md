# RemoteCode OpenCode Plugin

OpenCode desktop plugin for streaming agent state, session summaries, and events to the RemoteCode relay.

## Requirements
- Node.js 18+
- RemoteCode relay running (default `http://localhost:8787`)

## Install
### Option A: CLI (bunx)
```bash
bun install
bunx remotecode install
```

Pair a phone (writes device credentials to `.opencode/remotecode.json`):
```bash
bunx remotecode auth
```

This provisions:
- `.opencode/plugins/remotecode.js` (the OpenCode plugin entrypoint)
- `.opencode/package.json` (plugin dependencies)
- `.opencode/remotecode.json` (relay/device config)

### Option B: Manual
Create the files above yourself (see sections below).
## Configure
Create `.opencode/remotecode.json` (or run the CLI to generate it):
```json
{
  "relay_url": "http://localhost:8787",
  "device_id": "",
  "device_token": ""
}
```

## Run
Restart OpenCode; it auto-loads project plugins from `.opencode/plugins/`.

On first run, the plugin requests a pairing token from the relay and prints a QR code to the terminal/log output. Scan it with the iOS app to complete pairing.

If you ran `bunx remotecode auth`, OpenCode will reuse the persisted `device_id` + `device_token` on startup and connect without re-pairing.

### Dev sidecar (optional)
For debugging outside OpenCode:
```bash
npm --prefix apps/plugin run dev
```

## Hook Wiring
The plugin exposes a hook adapter so the OpenCode host can feed updates:
- `createPlugin({ hooks })` auto-wires hooks on creation.
- `plugin.attachHooks(hooks)` manually attaches hooks.
- `plugin.handleHook({ type, payload, severity })` pushes a single event.

Supported hooks (either callbacks or emitter-style `hooks.on(type, handler)`):
- `event`
- `session.create`
- `session.complete`
- `tool.execute.before`
- `tool.execute.after`
- `chat.message`
- `agents.update`
- `session.summary`

### Hook Payload Shapes
- `agents.update`: accepts `{ agents: [...] }`, `{ agent_states: [...] }`, `{ agentStates: [...] }`, or a bare array of agents.
- `session.summary`: accepts `{ session_summary: ... }`, `{ sessionSummary: ... }`, `{ summary: ... }`, or any summary object.
- `event`: accepts `{ type, payload, severity }` or any event payload (forwarded as `event.append`).
- `session.create` / `session.complete` / `tool.execute.*` / `chat.message`: any payload object; forwarded as events, and session hooks also refresh `session_summary` when present.
