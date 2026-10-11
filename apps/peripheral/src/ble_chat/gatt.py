"""
Minimal BlueZ GATT server and advertiser over D-Bus.

BlueZ (bluetoothd) owns the radio. An application that wants to be a peripheral
exports D-Bus objects that implement these interfaces, then asks BlueZ to
register them:

  org.bluez.GattService1          one per service
  org.bluez.GattCharacteristic1   one per characteristic
  org.bluez.LEAdvertisement1      what to broadcast

BlueZ then calls back into our objects: ReadValue / WriteValue when a central
reads or writes, StartNotify / StopNotify when it subscribes. We push a
notification by emitting PropertiesChanged on the characteristic's Value.
"""

from __future__ import annotations

from typing import Callable, Optional

import dbus
import dbus.service

BLUEZ = "org.bluez"
GATT_MANAGER = "org.bluez.GattManager1"
ADV_MANAGER = "org.bluez.LEAdvertisingManager1"
GATT_SERVICE = "org.bluez.GattService1"
GATT_CHRC = "org.bluez.GattCharacteristic1"
LE_ADVERTISEMENT = "org.bluez.LEAdvertisement1"
DBUS_OM = "org.freedesktop.DBus.ObjectManager"
DBUS_PROPS = "org.freedesktop.DBus.Properties"


class Application(dbus.service.Object):
    """Root object. BlueZ walks GetManagedObjects to discover services and characteristics."""

    PATH = "/com/blebridge/chat"

    def __init__(self, bus: dbus.Bus) -> None:
        super().__init__(bus, self.PATH)
        self.services: list[Service] = []

    def add_service(self, service: "Service") -> None:
        self.services.append(service)

    @dbus.service.method(DBUS_OM, out_signature="a{oa{sa{sv}}}")
    def GetManagedObjects(self):  # noqa: N802 (D-Bus naming)
        objects = {}
        for service in self.services:
            objects[service.path] = service.get_properties()
            for chrc in service.characteristics:
                objects[chrc.path] = chrc.get_properties()
        return objects


class Service(dbus.service.Object):
    def __init__(self, bus: dbus.Bus, index: int, uuid: str, primary: bool = True) -> None:
        self.path = f"{Application.PATH}/service{index}"
        self.uuid = uuid
        self.primary = primary
        self.characteristics: list[Characteristic] = []
        super().__init__(bus, self.path)

    def add_characteristic(self, chrc: "Characteristic") -> None:
        self.characteristics.append(chrc)

    @dbus.service.method(DBUS_PROPS, in_signature="s", out_signature="a{sv}")
    def GetAll(self, interface):  # noqa: N802
        if interface != GATT_SERVICE:
            raise dbus.exceptions.DBusException("org.freedesktop.DBus.Error.InvalidArgs")
        return self.get_properties()[GATT_SERVICE]

    def get_properties(self):
        return {
            GATT_SERVICE: {
                "UUID": self.uuid,
                "Primary": self.primary,
                "Characteristics": dbus.Array(
                    [dbus.ObjectPath(c.path) for c in self.characteristics], signature="o"
                ),
            }
        }


class Characteristic(dbus.service.Object):
    """
    One characteristic. Subclass or pass callbacks:
      on_write(data: bytes, mtu: int)   called when a central writes
    Call notify(data) to push a value to subscribed centrals.
    """

    def __init__(
        self,
        bus: dbus.Bus,
        index: int,
        uuid: str,
        flags: list[str],
        service: Service,
        on_write: Optional[Callable[[bytes, int], None]] = None,
    ) -> None:
        self.path = f"{service.path}/char{index}"
        self.uuid = uuid
        self.flags = flags
        self.service = service
        self.on_write = on_write
        self.value: bytes = b""
        self.notifying = False
        self.mtu = 23
        self.on_subscribe: Optional[Callable[[bool], None]] = None
        super().__init__(bus, self.path)

    @dbus.service.method(DBUS_PROPS, in_signature="s", out_signature="a{sv}")
    def GetAll(self, interface):  # noqa: N802
        if interface != GATT_CHRC:
            raise dbus.exceptions.DBusException("org.freedesktop.DBus.Error.InvalidArgs")
        return self.get_properties()[GATT_CHRC]

    def get_properties(self):
        return {
            GATT_CHRC: {
                "Service": dbus.ObjectPath(self.service.path),
                "UUID": self.uuid,
                "Flags": dbus.Array(self.flags, signature="s"),
                "Notifying": self.notifying,
            }
        }

    @dbus.service.method(GATT_CHRC, in_signature="a{sv}", out_signature="ay")
    def ReadValue(self, options):  # noqa: N802
        self._update_mtu(options)
        return dbus.Array(self.value, signature="y")

    @dbus.service.method(GATT_CHRC, in_signature="aya{sv}")
    def WriteValue(self, value, options):  # noqa: N802
        self._update_mtu(options)
        data = bytes(bytearray(value))
        self.value = data
        if self.on_write:
            self.on_write(data, self.mtu)

    @dbus.service.method(GATT_CHRC)
    def StartNotify(self):  # noqa: N802
        self.notifying = True
        if self.on_subscribe:
            self.on_subscribe(True)

    @dbus.service.method(GATT_CHRC)
    def StopNotify(self):  # noqa: N802
        self.notifying = False
        if self.on_subscribe:
            self.on_subscribe(False)

    @dbus.service.signal(DBUS_PROPS, signature="sa{sv}as")
    def PropertiesChanged(self, interface, changed, invalidated):  # noqa: N802
        pass

    def notify(self, data: bytes) -> bool:
        """Push a value to subscribers. Returns False if nobody is subscribed."""
        self.value = data
        if not self.notifying:
            return False
        self.PropertiesChanged(GATT_CHRC, {"Value": dbus.Array(data, signature="y")}, [])
        return True

    def _update_mtu(self, options) -> None:
        mtu = options.get("mtu") if options else None
        if mtu:
            self.mtu = int(mtu)


class Advertisement(dbus.service.Object):
    PATH = "/com/blebridge/chat/advertisement0"

    def __init__(self, bus: dbus.Bus, local_name: str, service_uuids: list[str]) -> None:
        self.local_name = local_name
        self.service_uuids = service_uuids
        super().__init__(bus, self.PATH)

    @dbus.service.method(DBUS_PROPS, in_signature="s", out_signature="a{sv}")
    def GetAll(self, interface):  # noqa: N802
        return {
            "Type": "peripheral",
            "ServiceUUIDs": dbus.Array(self.service_uuids, signature="s"),
            "LocalName": self.local_name,
            "Discoverable": dbus.Boolean(True),
        }

    @dbus.service.method(LE_ADVERTISEMENT)
    def Release(self):  # noqa: N802
        pass


def find_adapter(bus: dbus.Bus) -> str:
    """Return the object path of the first adapter that can advertise and host GATT."""
    manager = dbus.Interface(bus.get_object(BLUEZ, "/"), DBUS_OM)
    for path, interfaces in manager.GetManagedObjects().items():
        if GATT_MANAGER in interfaces and ADV_MANAGER in interfaces:
            return path
    raise RuntimeError("No Bluetooth adapter with GATT + advertising support found")
