<p align="center">
  <svg width="234" height="42" viewBox="0 0 234 42" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="6" width="30" height="30" rx="6" fill="#B7B1B1"/>
    <rect x="12" y="12" width="18" height="18" rx="3" fill="#4B4646"/>
    <text x="46" y="28" font-size="20" font-family="Arial, Helvetica, sans-serif" fill="#4B4646">remotecode</text>
  </svg>
</p>

<p align="center">
  <a href="#quickstart"><img alt="status" src="https://img.shields.io/badge/status-v1%20alpha-6f42c1"></a>
  <a href="#architecture"><img alt="transport" src="https://img.shields.io/badge/transport-websocket-0ea5e9"></a>
  <a href="#"><img alt="self-hosted" src="https://img.shields.io/badge/self--hosted-yes-22c55e"></a>
  <a href="#"><img alt="ios" src="https://img.shields.io/badge/iOS-SwiftUI-111827"></a>
</p>

# RemoteCode

Your OpenCode agents, on your phone. 📱

RemoteCode is a self-hosted mobile companion for OpenCode. It gives you a live, view-only dashboard of agent status, current session summary, and recent tool events—securely paired via QR and streamed over WebSocket.

## Why people will love it ✨
- **Live visibility** ⚡: see agent state and session progress in real time
- **Privacy-first** 🔒: secrets redacted, no file contents in v1
- **Self-hosted** 🧰: your relay, your data, your retention settings
- **Simple pairing** 📷: scan a QR, you're in
- **Fast feedback loop** 🧭: recent tool events at a glance

## What’s included (v1) 🧩
- OpenCode plugin (desktop) for events + snapshots
- Cloud relay (Node.js + Fastify + WebSocket + Postgres)
- Vue frontend (status dashboard for relay)
- SwiftUI iOS app (view-only dashboard)

## Dev
Run relay + frontend together:
`npm run dev`

## Quickstart (coming soon) 🚀
- Self-host relay via docker-compose
- Install the OpenCode plugin
- Scan QR from iOS app to pair

## Architecture 🏗️
- Desktop plugin opens **outbound WebSocket** to relay
- iOS app connects to relay for live status
- Postgres stores snapshots + event logs (30‑day default retention)
- Secret redaction enforced in plugin and relay

## Roadmap 🗺️
- Configurable privacy filters per device
- Push notifications for important events
- Command execution from phone (opt-in)

## Docs 📚
- Design: `docs/plans/2026-01-22-opencode-mobile-companion-design.md`

## Contributing 🤝
PRs welcome. Keep changes small, tested, and privacy‑safe.

## License
TBD
