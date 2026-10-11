# Bluetooth-only group chat: setup and offline install

```
[Phone A] --BLE--\
[Phone B] --BLE----> [Laptop hub: Python + BlueZ] --forwards every message to every phone
[Phone C] --BLE--/   (the laptop user can chat too, from the terminal)
```

No WiFi, no mobile data, no server. The only non-Bluetooth step is loading the page
onto each phone once, because Web Bluetooth requires a secure context.

## 1. Laptop: start the hub

```bash
cd apps/peripheral
python3 -m venv --system-site-packages .venv && .venv/bin/pip install -r requirements.txt   # first time only
cd src && ../.venv/bin/python -m ble_chat.main --name "Adheesh's laptop"
```

Wait for `Advertising as 'ble-chat'`. This terminal is the laptop's chat window: type a line, press Enter.

## 2. Phones: install the app once

**Option A, hosted (easiest):** open the GitHub Pages URL in Chrome for Android:

    https://pappukrs.github.io/ble-to-cloud-bridge/#chat

Then Chrome menu -> **Add to Home screen** / **Install app**. Done. Internet is needed
only for this one visit; the service worker caches everything.

**Option B, no internet at all:** USB cable.

```bash
npm run dev:web                       # on the laptop
adb devices                           # phone must show "device", not "unauthorized"
adb reverse tcp:5173 tcp:5173
```

On the phone open `http://localhost:5173/#chat`, then Add to Home screen. Unplug.

## 3. Chat

1. Turn off WiFi and mobile data on the phones to prove the point. Keep Bluetooth on.
2. Open the installed app, type your name, tap **Connect to laptop**, pick `ble-chat`.
3. Every phone and the laptop terminal see every message, with the sender's name.

Repeat step 2 on as many phones as you like. Linux typically allows 5 to 8 simultaneous connections.

## How it works

- Each phone is a BLE **central**, the laptop is the **peripheral** (a role flip from the cloud bridge feature).
- A message is a JSON envelope `{id, from, text, ts}`. The `id` is a random 8-char string the app makes once and keeps.
- The envelope is UTF-8 and split into chunks of MTU-4 bytes with a 1-byte header (sequence + last flag). See `packages/shared/src/chat.ts` and `apps/peripheral/src/ble_chat/chunk.py`.
- The hub reassembles, prints, and re-chunks the same envelope to the `outbox` characteristic. BlueZ delivers that notification to every subscribed phone. Each phone drops envelopes whose `id` is its own.

## Troubleshooting

- `adb devices` shows `unauthorized`: unlock the phone and accept the USB debugging prompt.
- Chooser shows no `ble-chat`: the hub terminal must say "Advertising". Restart it. Some adapters stop advertising while a phone is connected; if a second phone cannot find the laptop, that is why. Intel adapters on recent kernels keep advertising.
- "No Services matching UUID": the phone cached an old table. Toggle Bluetooth off and on on the phone.
- Hub prints "nobody is connected yet": no phone has tapped Connect.
- `RegisterApplication failed`: run `journalctl -u bluetooth -n 20` for the daemon's reason.
