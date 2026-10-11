"""
Group-chat hub logic, independent of BlueZ so it can be unit tested.

Every phone connects to the laptop. The hub forwards each envelope it receives
to all subscribed phones (the sender included; phones drop their own id), prints
it for the laptop user, and lets the laptop user send too.
"""

from __future__ import annotations

from typing import Callable, Optional

from .chunk import Reassembler, encode, payload_size_for_mtu
from .envelope import Envelope, decode, now_ms

Notify = Callable[[bytes], bool]
Printer = Callable[[str], None]


class ChatHub:
    def __init__(self, notify: Notify, printer: Printer, name: str = "laptop", hub_id: str = "hub") -> None:
        self._notify = notify
        self._print = printer
        self.name = name
        self.hub_id = hub_id
        self.mtu = 23
        self.reassembler = Reassembler()
        self.forwarded = 0
        self.rejected = 0

    # ---- phone -> hub ----
    def on_chunk(self, data: bytes, mtu: int) -> Optional[Envelope]:
        """Feed one BLE write. Returns the envelope if a full message completed."""
        self.mtu = mtu
        text = self.reassembler.feed(data)
        if text is None:
            return None
        envelope = decode(text)
        if envelope is None:
            self.rejected += 1
            self._print(f"dropped a malformed message ({text[:40]!r})")
            return None
        self._print(f"{envelope.sender}: {envelope.text}")
        self._forward(envelope)
        return envelope

    # ---- hub -> phones ----
    def say(self, text: str) -> bool:
        envelope = Envelope(self.hub_id, self.name, text, now_ms())
        sent = self._forward(envelope)
        if sent:
            self._print(f"{self.name}: {text}")
        else:
            self._print("nobody is connected yet, message not sent")
        return sent

    def _forward(self, envelope: Envelope) -> bool:
        chunks = encode(envelope.encode(), payload_size_for_mtu(self.mtu))
        for chunk in chunks:
            if not self._notify(chunk):
                return False
        self.forwarded += 1
        return True
