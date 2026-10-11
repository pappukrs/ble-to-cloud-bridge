"""
Run the laptop as a BLE chat peripheral.

    python -m ble_chat.main

Type a line and press Enter to send it to the phone. Incoming messages print
as they arrive. Ctrl+C to stop.
"""

from __future__ import annotations

import signal
import sys
from datetime import datetime

import dbus
import dbus.mainloop.glib
from gi.repository import GLib

from .chunk import Reassembler, encode, payload_size_for_mtu
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
from .uuids import CHAT_SERVICE_UUID, INBOX_UUID, LOCAL_NAME, OUTBOX_UUID


def stamp() -> str:
    return datetime.now().strftime("%H:%M:%S")


class ChatPeripheral:
    def __init__(self, bus: dbus.Bus) -> None:
        self.app = Application(bus)
        service = Service(bus, 0, CHAT_SERVICE_UUID)
        self.inbox = Characteristic(bus, 0, INBOX_UUID, ["write", "write-without-response"], service, on_write=self._on_write)
        self.outbox = Characteristic(bus, 1, OUTBOX_UUID, ["notify"], service)
        self.outbox.on_subscribe = self._on_subscribe
        service.add_characteristic(self.inbox)
        service.add_characteristic(self.outbox)
        self.app.add_service(service)
        self.adv = Advertisement(bus, LOCAL_NAME, [CHAT_SERVICE_UUID])
        self.reassembler = Reassembler()
        self.mtu = 23

    # ---- BLE -> terminal ----
    def _on_write(self, data: bytes, mtu: int) -> None:
        self.mtu = mtu
        message = self.reassembler.feed(data)
        if message is not None:
            print(f"\r[{stamp()}] phone: {message}\n> ", end="", flush=True)

    def _on_subscribe(self, subscribed: bool) -> None:
        state = "subscribed to outbox" if subscribed else "unsubscribed"
        print(f"\r[{stamp()}] phone {state}\n> ", end="", flush=True)

    # ---- terminal -> BLE ----
    def send(self, message: str) -> None:
        chunks = encode(message, payload_size_for_mtu(self.mtu))
        for chunk in chunks:
            if not self.outbox.notify(chunk):
                print(f"[{stamp()}] nobody subscribed yet, message not sent")
                return
        print(f"[{stamp()}] me: {message}  ({len(chunks)} chunk{'s' if len(chunks) != 1 else ''}, mtu {self.mtu})")


def main() -> int:
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    bus = dbus.SystemBus()
    adapter_path = find_adapter(bus)
    adapter = bus.get_object(BLUEZ, adapter_path)
    adapter_props = dbus.Interface(adapter, "org.freedesktop.DBus.Properties")
    adapter_props.Set("org.bluez.Adapter1", "Powered", dbus.Boolean(True))

    chat = ChatPeripheral(bus)
    loop = GLib.MainLoop()
    failed = False

    gatt_manager = dbus.Interface(adapter, GATT_MANAGER)
    adv_manager = dbus.Interface(adapter, ADV_MANAGER)

    def on_error(what):
        def handler(error):
            nonlocal failed
            failed = True
            print(f"{what} failed: {error}", file=sys.stderr)
            loop.quit()
        return handler

    def on_app_registered():
        print(f"GATT service registered on {adapter_path}")
        adv_manager.RegisterAdvertisement(
            chat.adv.PATH, {}, reply_handler=on_adv_registered, error_handler=on_error("RegisterAdvertisement")
        )

    def on_adv_registered():
        print(f"Advertising as '{LOCAL_NAME}' with service {CHAT_SERVICE_UUID}")
        print("Waiting for the phone to connect. Type a message and press Enter.")
        print("> ", end="", flush=True)

    gatt_manager.RegisterApplication(
        chat.app.PATH, {}, reply_handler=on_app_registered, error_handler=on_error("RegisterApplication")
    )

    def on_stdin(_source, _condition):
        line = sys.stdin.readline()
        if not line:
            loop.quit()
            return False
        text = line.rstrip("\n")
        if text:
            chat.send(text)
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
            adv_manager.UnregisterAdvertisement(chat.adv.PATH)
            gatt_manager.UnregisterApplication(chat.app.PATH)
        except dbus.DBusException:
            pass
        print("\nstopped")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
