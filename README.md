# ble-to-cloud-bridge

Two features built to learn Bluetooth Low Energy and WebSocket communication from the inside, in TypeScript and Python, with tests and CI.

**Live app:** https://pappukrs.github.io/ble-to-cloud-bridge/ (Chrome on Android, Windows, macOS, or Linux with the Web Bluetooth flag)

## Feature 1: BLE to cloud bridge

```
[Phone: BLE GATT server]
        | BLE (~10 m)
        v
[Laptop Chrome: Web Bluetooth]  ---- WebSocket ---->  [Node relay]  ---->  [Dashboards anywhere]
```

The laptop pairs with a phone over Bluetooth, forwards every characteristic value to a WebSocket relay, and the relay broadcasts to every dashboard. Token auth on the first frame, payload limits, reconnect with backoff.

## Feature 2: Bluetooth-only group chat (offline PWA)

```
[Phone A] --BLE--\
[Phone B] --BLE----> [Laptop hub: Python + BlueZ]  --> every message to every phone
[Phone C] --BLE--/
```

No internet, no server. Phones install the app once, then chat with each other through the laptop's Bluetooth radio. Messages are JSON envelopes chunked into 20-byte BLE packets and reassembled on the other side. The same chunk codec is implemented in TypeScript and Python and tested with shared vectors.

Setup: [docs/offline-chat.md](docs/offline-chat.md)

## Repository

| Path | What | Tests |
|---|---|---|
| `apps/web` | React + Vite + TypeScript PWA: bridge page, dashboard, chat | Vitest + Testing Library, fake Bluetooth stack |
| `apps/server` | Node + `ws` relay, bundled with esbuild | Vitest, real sockets on an ephemeral port |
| `apps/peripheral` | Python BLE peripheral/hub on BlueZ over D-Bus | pytest |
| `packages/shared` | zod message schema, chunk codec, chat envelope | Vitest |
| `docs/` | plan, setup guides, learning notes | |

CI runs typecheck, lint, format check, all test suites, and both builds on every push. The web app deploys to GitHub Pages from `main`.

## Run locally

```bash
npm install
AUTH_TOKEN=12345 npm run dev:server      # relay on :8080
npm run dev:web                          # app on :5173
```

Python hub for the chat: see [apps/peripheral/README.md](apps/peripheral/README.md).

## Things learned the hard way

- An advertisement and a GATT table are separate. A phone can advertise a service it is not serving.
- Android rotates its random BLE address every few minutes; stale addresses make diagnostics lie.
- Linux Chrome needs `chrome://flags/#enable-web-bluetooth`; every other platform has it on by default.
- BlueZ rejects a GATT application if a characteristic's `Service` property is a string instead of an object path. The reason only appears in `journalctl -u bluetooth`.
- A BLE packet carries 20 bytes by default. Everything bigger needs a transport layer, so this repo has one.

## Plan and progress

[docs/PLAN.md](docs/PLAN.md)
