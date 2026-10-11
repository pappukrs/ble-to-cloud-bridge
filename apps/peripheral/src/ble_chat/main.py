"""
Run the laptop as the Bluetooth chat hub.

    python -m ble_chat.main [--name <display name>]

Phones connect over BLE, every message is forwarded to every phone, and the
laptop user can chat too: type a line and press Enter. Ctrl+C to stop.
"""

from __future__ import annotations

import argparse
import signal
import sys
from datetime import datetime

import dbus
import dbus.mainloop.glib
from gi.repository import GLib

from .gatt import (
    ADV_MANAGER,
    BLUEZ,
    GATT_MANAGER,
    Advertisement,
    Application,
    Characteristic,
    Service,
    find_adapter,
)
from .hub import ChatHub
from .uuids import CHAT_SERVICE_UUID, INBOX_UUID, LOCAL_NAME, OUTBOX_UUID


def stamp() -> str:
    return datetime.now().strftime("%H:%M:%S")


def build(bus: dbus.Bus, name: str) -> tuple[Application, Advertisement, ChatHub]:
    app = Application(bus)
    service = Service(bus, 0, CHAT_SERVICE_UUID)
    outbox = Characteristic(bus, 1, OUTBOX_UUID, ["notify"], service)

    def printer(line: str) -> None:
        print(f"\r[{stamp()}] {line}\n> ", end="", flush=True)

    hub = ChatHub(notify=outbox.notify, printer=printer, name=name)
    inbox = Characteristic(
        bus,
        0,
        INBOX_UUID,
        ["write", "write-without-response"],
        service,
        on_write=lambda data, mtu: hub.on_chunk(data, mtu),
    )
    outbox.on_subscribe = lambda on: printer("a phone subscribed" if on else "last phone left")
    service.add_characteristic(inbox)
    service.add_characteristic(outbox)
    app.add_service(service)
    adv = Advertisement(bus, LOCAL_NAME, [CHAT_SERVICE_UUID])
    return app, adv, hub


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Bluetooth chat hub")
    parser.add_argument("--name", default="laptop", help="display name for messages typed here")
    args = parser.parse_args(argv)

    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()
    adapter_path = find_adapter(bus)
    adapter = bus.get_object(BLUEZ, adapter_path)
    adapter_props = dbus.Interface(adapter, "org.freedesktop.DBus.Properties")
    adapter_props.Set("org.bluez.Adapter1", "Powered", dbus.Boolean(True))

    app, adv, hub = build(bus, args.name)
    loop = GLib.MainLoop()
    failed = False

    gatt_manager = dbus.Interface(adapter, GATT_MANAGER)
    adv_manager = dbus.Interface(adapter, ADV_MANAGER)

    def on_error(what):
        def handler(error):
            nonlocal failed
            failed = True
            print(f"{what} failed: {error}", file=sys.stderr)
            print("Hint: journalctl -u bluetooth shows the daemon's reason.", file=sys.stderr)
            loop.quit()

        return handler

    def on_app_registered():
        print(f"GATT service registered on {adapter_path}")
        adv_manager.RegisterAdvertisement(
            adv.PATH, {}, reply_handler=on_adv_registered, error_handler=on_error("RegisterAdvertisement")
        )

    def on_adv_registered():
        print(f"Advertising as '{LOCAL_NAME}'. Chatting as '{args.name}'.")
        print("Phones: open the app, tap Connect to laptop. Type here to send to everyone.")
        print("> ", end="", flush=True)

    gatt_manager.RegisterApplication(
        app.PATH, {}, reply_handler=on_app_registered, error_handler=on_error("RegisterApplication")
    )

    def on_stdin(_source, _condition):
        line = sys.stdin.readline()
        if not line:
            loop.quit()
            return False
        text = line.rstrip("\n")
        if text:
            hub.say(text)
        else:
            print("> ", end="", flush=True)
        return True

    GLib.io_add_watch(sys.stdin, GLib.IO_IN, on_stdin)
    GLib.unix_signal_add(GLib.PRIORITY_HIGH, signal.SIGTERM, lambda: (loop.quit(), False)[1])

    try:
        loop.run()
    except KeyboardInterrupt:
        pass
    finally:
        try:
            adv_manager.UnregisterAdvertisement(adv.PATH)
            gatt_manager.UnregisterApplication(app.PATH)
        except dbus.DBusException:
            pass
        print("\nstopped")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
