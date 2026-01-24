# RemoteCode OpenCode Plugin

OpenCode desktop plugin for streaming agent state, session summaries, and events to the RemoteCode relay.

## Requirements
- Node.js 18+
- RemoteCode relay running (default `http://localhost:8787`)

## Install
```bash
npm --prefix apps/plugin install
```

## Configure
Create `apps/plugin/.env`:
```
RELAY_URL=http://localhost:8787
# Optional: reuse existing device credentials
DEVICE_ID=
DEVICE_TOKEN=
```

## Run
```bash
npm --prefix apps/plugin run dev
```

On first run, the plugin requests a pairing token from the relay and prints a QR code to the terminal. Scan it with the iOS app to complete pairing.

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
