"""
Chat envelope: the JSON text that travels inside the chunked transport.
Mirrors packages/shared/src/chat.ts (encodeEnvelope / decodeEnvelope).

    {"id": "<sender id>", "from": "<display name>", "text": "<message>", "ts": <ms>}
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Optional

MAX_NAME_LENGTH = 24
MAX_TEXT_LENGTH = 2000


@dataclass(frozen=True)
class Envelope:
    id: str
    sender: str
    text: str
    ts: int

    def encode(self) -> str:
        return json.dumps(
            {
                "id": self.id,
                "from": self.sender[:MAX_NAME_LENGTH],
                "text": self.text[:MAX_TEXT_LENGTH],
                "ts": self.ts,
            },
            separators=(",", ":"),
            ensure_ascii=False,
        )


def decode(raw: str) -> Optional[Envelope]:
    """Return None for anything that is not a well-formed envelope."""
    try:
        obj = json.loads(raw)
    except (ValueError, TypeError):
        return None
    if not isinstance(obj, dict):
        return None
    sender_id = obj.get("id")
    sender = obj.get("from")
    text = obj.get("text")
    ts = obj.get("ts")
    if not isinstance(sender_id, str) or not sender_id:
        return None
    if not isinstance(sender, str) or not sender:
        return None
    if not isinstance(text, str):
        return None
    if isinstance(ts, bool) or not isinstance(ts, (int, float)):
        return None
    return Envelope(sender_id, sender[:MAX_NAME_LENGTH], text[:MAX_TEXT_LENGTH], int(ts))


def now_ms() -> int:
    return int(time.time() * 1000)
