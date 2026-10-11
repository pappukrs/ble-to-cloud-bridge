# ble-chat peripheral (laptop side)

Turns a Linux laptop into a BLE peripheral that advertises a chat service.
The phone (central) connects with Web Bluetooth and the two exchange messages
over the radio only. No network involved.

## Requirements

- Linux with BlueZ 5.50+ (`bluetoothctl --version`)
- `python3-dbus` and `python3-gi` from the OS package manager
- A Bluetooth adapter that supports LE advertising (`bluetoothctl show` lists `LEAdvertisingManager1` support as `SupportedInstances`)

## Run

```bash
cd apps/peripheral
python3 -m venv --system-site-packages .venv
.venv/bin/pip install -r requirements.txt
cd src && ../.venv/bin/python -m ble_chat.main
```

Type a line and press Enter to send. Incoming messages print as they arrive.

## Test

```bash
cd apps/peripheral && .venv/bin/python -m pytest
```

## GATT layout

| Characteristic | UUID | Properties | Direction |
|---|---|---|---|
| inbox  | `7a0b1001-6f6c-4c3a-9d2e-0123456789ab` | write, write-without-response | phone -> laptop |
| outbox | `7a0b1002-6f6c-4c3a-9d2e-0123456789ab` | notify | laptop -> phone |

Service UUID: `7a0b1000-6f6c-4c3a-9d2e-0123456789ab`, advertised with local name `ble-chat`.

## How it talks to BlueZ

`bluetoothd` owns the radio. This program exports D-Bus objects implementing
`org.bluez.GattService1`, `org.bluez.GattCharacteristic1` and
`org.bluez.LEAdvertisement1`, then calls `RegisterApplication` and
`RegisterAdvertisement` on the adapter. BlueZ calls back `WriteValue` when the
phone writes and we emit `PropertiesChanged` on `Value` to notify.

Gotcha found while building: every `Service` property on a characteristic must be
a D-Bus object path, not a string, or BlueZ logs
`Failed to obtain service path for characteristic` and rejects the whole application.
`journalctl -u bluetooth` is where that error shows up.
