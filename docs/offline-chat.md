# Bluetooth-only chat: setup and offline install

Phone (central, Chrome for Android) <-- BLE --> Laptop (peripheral, Python + BlueZ).
No WiFi, no mobile data, no server. The only non-Bluetooth step is loading the
page onto the phone once, because Web Bluetooth requires a secure context.

## 1. Laptop: start the peripheral

```bash
cd apps/peripheral/src
../.venv/bin/python -m ble_chat.main
```

You should see `Advertising as 'ble-chat'`. Leave this terminal open; it is the laptop's chat window.

## 2. Laptop: start the web app

```bash
npm run dev:web
```

## 3. Phone: load the page once over USB (no network)

1. On the phone enable Developer options and USB debugging, plug in the cable, accept the prompt.
2. On the laptop:
   ```bash
   adb devices            # phone must show as "device", not "unauthorized"
   adb reverse tcp:5173 tcp:5173
   ```
   This makes the phone's `localhost:5173` reach the laptop's dev server through the cable.
3. On the phone open Chrome and go to `http://localhost:5173/#chat`.
   `localhost` counts as secure, so Web Bluetooth is available.

## 4. Phone: install as an app

Chrome menu -> **Add to Home screen** (or **Install app**). The service worker has
already cached everything, so from now on the app launches from the home screen
with no cable and no network.

## 5. Chat

1. Unplug the cable. Turn off WiFi and mobile data to prove the point.
2. Open the installed app, tap **Connect to laptop**, pick `ble-chat`.
3. Type on the phone; it appears in the laptop terminal. Type in the terminal; it appears on the phone.

## Troubleshooting

- `adb devices` shows `unauthorized`: unlock the phone and accept the USB debugging prompt.
- Chooser shows no `ble-chat`: the peripheral terminal must say "Advertising". Restart it.
- "No Services matching UUID": BlueZ on the phone side cached an old table. Toggle Bluetooth off and on on the phone.
- Laptop prints "nobody subscribed yet": the phone has not connected or tapped Connect.
- Only the first 19 bytes of each chunk arrive: expected with the default MTU. Long messages are chunked and reassembled; see `packages/shared/src/chat.ts`.

## Production build

`npm run build -w @ble-bridge/web` writes `apps/web/dist` with `sw.js` and `manifest.webmanifest`.
Serve `dist/` from any static server on the laptop and use the same `adb reverse` trick with its port.
