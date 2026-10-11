# ble-to-cloud-bridge — Project Plan

Phone (BLE GATT server) → Laptop browser (Web Bluetooth, React/TS) → WebSocket relay (Node/TS on AWS) → Live dashboard (any device).

Everything in TypeScript, tested with Vitest, checked by GitHub Actions, deployed to AWS.

---

## 1. Repository layout (npm workspaces monorepo)

```
ble-to-cloud-bridge/
├── apps/
│   ├── web/                  # React + Vite + TypeScript (BLE client + dashboard)
│   │   ├── src/
│   │   │   ├── ble/          # Web Bluetooth wrapper (connect, read, write, notify)
│   │   │   ├── ws/           # WebSocket client with reconnect
│   │   │   ├── components/   # ConnectButton, LiveValue, Dashboard, Log
│   │   │   ├── pages/        # Bridge page (laptop), Dashboard page (any device)
│   │   │   └── main.tsx
│   │   ├── test/             # Vitest + Testing Library, fake navigator.bluetooth
│   │   ├── vite.config.ts
│   │   └── package.json
│   └── server/               # Node + TypeScript + ws
│       ├── src/
│       │   ├── index.ts      # entry: http server + ws upgrade
│       │   ├── relay.ts      # pure broadcast logic (no network) — easy to test
│       │   ├── auth.ts       # token check on connect
│       │   └── config.ts     # env parsing (PORT, AUTH_TOKEN, MAX_PAYLOAD)
│       ├── test/             # Vitest, real ws clients on an ephemeral port
│       └── package.json
├── packages/
│   └── shared/               # Message types + zod schemas used by both sides
│       ├── src/messages.ts
│       └── package.json
├── infra/                    # AWS notes, nginx config, pm2 ecosystem file
├── docs/                     # PLAN.md, learning-notes (the original lab md)
├── .github/workflows/
│   ├── ci.yml                # typecheck + lint + test + build on every push/PR
│   ├── deploy-web.yml        # S3 sync + CloudFront invalidation on main
│   └── deploy-server.yml     # SSH to EC2, git pull, npm ci, pm2 reload
├── package.json              # workspaces root, shared scripts
├── tsconfig.base.json        # strict settings shared by all packages
├── .eslintrc.cjs / .prettierrc
└── README.md
```

Why a monorepo: frontend and backend share one `Message` type. When the shape changes, TypeScript breaks the build on both sides instead of breaking at runtime.

---

## 2. Tech choices

| Area | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) everywhere | One language, shared types across web and server |
| Frontend | React 18 + Vite | Vite is fast, Vitest plugs in with zero config |
| Backend | Node 20 LTS + `ws` | Smallest WebSocket library, no framework needed |
| Validation | `zod` | Runtime check of incoming messages; types inferred from the schema |
| Tests | **Vitest** (not Jest) | Jest-compatible API, native ESM + TS, same runner for web and server |
| React tests | `@testing-library/react` + `jsdom` | Test behaviour (click → connect), not implementation |
| E2E (later) | Playwright | Optional; BLE can't run in CI, so e2e covers only WS + dashboard |
| Lint/format | ESLint + Prettier | CI fails on lint errors |
| Process manager | PM2 | Keeps server alive on EC2, restarts on crash |
| CI/CD | GitHub Actions | Free for public repos |

Vitest vs Jest: Jest needs `ts-jest` or Babel to handle TypeScript and ESM, and fights with Vite's config. Vitest reads `vite.config.ts` directly. The `describe / it / expect / vi.fn()` API is the same, so Jest knowledge transfers.

---

## 3. Shared message contract (`packages/shared`)

```ts
import { z } from 'zod';

export const BleReading = z.object({
  type: z.literal('reading'),
  source: z.literal('ble'),
  deviceName: z.string().optional(),
  value: z.string(),          // decoded characteristic text
  rssi: z.number().optional(),
  ts: z.number(),             // Date.now() on the bridge laptop
});

export const Hello = z.object({
  type: z.literal('hello'),
  role: z.enum(['bridge', 'dashboard']),
  token: z.string(),
});

export const Message = z.discriminatedUnion('type', [BleReading, Hello]);
export type Message = z.infer<typeof Message>;
```

Rule: the server never trusts a raw string. Every incoming frame is `JSON.parse` → `Message.safeParse` → reject on failure.

---

## 4. Testing strategy

### Server (`apps/server`)
- `relay.test.ts` — unit: `broadcast(sender, clients, msg)` sends to everyone except sender and only to OPEN sockets. No network, pure function.
- `auth.test.ts` — unit: valid token accepted, missing/wrong token rejected.
- `server.test.ts` — integration: start server on port 0, open 3 real `ws` clients, send from one, assert the other two receive, the sender doesn't. Also: oversized payload closes the socket, invalid JSON is ignored.

### Web (`apps/web`)
- `ble/client.test.ts` — unit with a fake `navigator.bluetooth` (mock `requestDevice`, `gatt.connect`, `getPrimaryService`, `startNotifications`). Assert the decoded value reaches the callback on `characteristicvaluechanged`.
- `ws/client.test.ts` — unit with a mock WebSocket class: reconnect with backoff, queues messages while disconnected.
- `components/*.test.tsx` — Testing Library: clicking "Connect" calls the BLE client; dashboard renders the latest value.

### What is NOT tested in CI
- Real BLE radio. Not possible on a GitHub runner. This is covered by a manual checklist in `docs/manual-test.md`.

Coverage target: 80% on `server/src` and `web/src/ble`, `web/src/ws`. UI components: smoke tests only.

---

## 5. GitHub Actions

### `ci.yml` — on every push and PR
```
checkout → setup-node 20 (cache npm) → npm ci
→ npm run typecheck   (tsc --noEmit in all workspaces)
→ npm run lint
→ npm test            (vitest run --coverage)
→ npm run build       (web: vite build, server: tsc)
```
Matrix not needed; one Ubuntu job. Branch protection on `main`: CI must pass before merge.

### `deploy-web.yml` — on push to `main`, path filter `apps/web/**`, `packages/**`
```
build web with VITE_WS_URL=wss://api.<domain>
→ aws s3 sync dist/ s3://<bucket> --delete
→ aws cloudfront create-invalidation --paths "/*"
```
Auth via GitHub OIDC → IAM role (no long-lived AWS keys in secrets).

### `deploy-server.yml` — on push to `main`, path filter `apps/server/**`, `packages/**`
```
ssh ec2 (key in secrets) → cd app && git pull && npm ci && npm run build
→ pm2 reload ble-relay
```
Stretch: replace with a Docker image + ECR, or go serverless (API Gateway WebSocket + Lambda).

---

## 6. Build phases (each phase ends with green CI)

| Phase | Deliverable | Tests added | Concepts to understand first |
|---|---|---|---|
| 0 | Monorepo scaffold, tsconfig, eslint, empty CI passing | — | Workspaces, strict TS, why CI from day 0 |
| 1 | `packages/shared` message schema | schema parse/reject tests | zod, runtime vs compile-time types |
| 2 | Server relay (local `ws://localhost:8080`) + auth + payload limit | relay unit + integration | TCP, HTTP Upgrade, WebSocket frames, broadcast |
| 3 | Wireshark session, write `docs/packet-notes.md` | — | 3-way handshake, 101 Switching Protocols, frame masking |
| 4 | Web: BLE client module + Connect button | fake `navigator.bluetooth` tests | Advertising, GATT, UUID, notify, secure context |
| 5 | Web: WS client with reconnect + Dashboard page | mock WebSocket tests, component tests | Backoff, message queueing, React state for live data |
| 6 | Bridge: BLE value → WS → dashboard, end to end on LAN | — | Latency, ordering, what happens on disconnect |
| 7 | AWS: EC2 + Nginx + certbot, `wss://api.<domain>` live | — | Reverse proxy, TLS termination, security groups |
| 8 | AWS: S3 + CloudFront + ACM + Route 53, `https://app.<domain>` live | — | CDN, OAC, SPA routing, cache invalidation |
| 9 | Deploy workflows + OIDC role | — | OIDC vs static keys, least privilege |
| 10 | README with diagram + demo GIF, filled BLE vs WiFi table | — | Writing for recruiters |

---

## 7. Concept discussion order (before each phase)

1. **Why TypeScript strict + shared types** — the one bug class it removes.
2. **WebSocket from the wire up** — TCP handshake → HTTP Upgrade → frames → ping/pong → close codes.
3. **Relay design** — why the server is dumb (broadcast only), who is "bridge" vs "dashboard", why auth on first message.
4. **BLE model** — central/peripheral, advertising vs connection, GATT tree, read/write/notify, MTU, why 10 m.
5. **Web Bluetooth constraints** — secure context, user gesture, filters vs optionalServices, Chrome-only.
6. **Testing without hardware** — dependency injection for `navigator.bluetooth`, ephemeral ports, what a fake vs mock is.
7. **CI thinking** — what a pipeline should catch, why typecheck before test, caching `node_modules`.
8. **AWS pieces** — what each service does and what breaks if it's missing (no HTTPS → no Web Bluetooth).

---

## 8. Definition of done

- `npm test` green locally and in CI with coverage report.
- `https://app.<domain>` loads, "Connect" pairs with nRF Connect, a second device's dashboard updates live.
- README has architecture diagram, demo GIF, setup steps, and the measured BLE vs WiFi table.
- Repo topics set: `bluetooth-low-energy`, `web-bluetooth`, `websocket`, `aws`, `react`, `typescript`, `nodejs`, `iot`, `vitest`, `github-actions`.

---

## 9. Feature 2: Bluetooth-only chat (offline PWA)

Decided 2026-10-12. No internet, no relay. Two devices, one BLE link, all chat bytes over the radio.

```
[Phone: Chrome for Android, installed PWA]        [Laptop: Linux]
  React chat page                                   Python BLE peripheral (BlueZ over D-Bus)
  Web Bluetooth = central        <---- BLE ---->    advertises "chat" service, terminal chat UI
```

Roles flip compared to Feature 1: the laptop is now the peripheral, the phone is the central.
nRF Connect is no longer needed.

### GATT layout

| Characteristic | UUID | Properties | Direction |
|---|---|---|---|
| inbox  | `0000c0de-0000-1000-8000-00805f9b34fb` ... see `packages/shared/src/chat.ts` | write | phone -> laptop |
| outbox | | notify | laptop -> phone |

### Wire format (chunking)

A BLE write/notify carries at most MTU-3 bytes (20 by default, up to ~500 after negotiation).
Messages are UTF-8, split into chunks with a 1-byte header:

```
bit 7      : last chunk flag
bits 0..6  : sequence number (wraps at 128)
bytes 1..n : payload
```

Receiver appends payloads in sequence order and emits the message on the last flag.
Same encoder/decoder in TypeScript (`packages/shared`) and Python (`apps/peripheral`), tested on both sides with the same vectors.

### Offline after install

- The web app is a PWA: manifest + service worker that precaches the build.
- First load must be a secure context. Use `adb reverse tcp:5173 tcp:5173` over USB so the phone opens `http://localhost:5173`.
- Then "Add to Home screen". From then on it launches with no network.

### Phases

| Phase | Deliverable | Tests |
|---|---|---|
| C1 | `apps/peripheral` Python: chunk codec + BlueZ GATT server + advertising + stdin chat | pytest on codec |
| C2 | `packages/shared/src/chat.ts`: TS chunk codec, same vectors | vitest round-trip, out-of-order, wrap |
| C3 | Web: `/#chat` page, connect to laptop, send/receive with chunking | fake Bluetooth tests |
| C4 | PWA: manifest, service worker, install flow doc, `adb reverse` steps | build check in CI |
| C5 | Manual test with WiFi and mobile data off; measure latency and throughput into learning notes | checklist |
| C6 | README section + demo GIF | |
