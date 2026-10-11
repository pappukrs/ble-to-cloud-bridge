"""
Chunked message transport over a BLE characteristic.

A single BLE write or notification carries at most MTU-3 bytes (20 with the
default MTU of 23). A chat message can be longer, so it is split into chunks:

    byte 0      : header
                    bit 7     = 1 on the last chunk of a message
                    bits 0..6 = sequence number, 0 for the first chunk, wraps at 128
    bytes 1..n  : UTF-8 payload

The receiver appends payloads in sequence order and emits the message when it
sees the last flag. Any gap in the sequence drops the partial message and waits
for the next chunk with sequence 0.

The TypeScript side (packages/shared/src/chat.ts) implements the same format.
"""

from __future__ import annotations

from typing import Optional

LAST_FLAG = 0x80
SEQ_MASK = 0x7F
HEADER_SIZE = 1
MIN_PAYLOAD_SIZE = 1
DEFAULT_MTU = 23


def payload_size_for_mtu(mtu: int) -> int:
    """Usable payload bytes per chunk for a negotiated ATT MTU."""
    return max(MIN_PAYLOAD_SIZE, mtu - 3 - HEADER_SIZE)


def encode(message: str, payload_size: int) -> list[bytes]:
    """Split a message into wire chunks. An empty message is one empty last chunk."""
    if payload_size < MIN_PAYLOAD_SIZE:
        raise ValueError("payload_size must be at least 1")
    data = message.encode("utf-8")
    pieces = [data[i : i + payload_size] for i in range(0, len(data), payload_size)] or [b""]
    chunks: list[bytes] = []
    for index, piece in enumerate(pieces):
        header = index & SEQ_MASK
        if index == len(pieces) - 1:
            header |= LAST_FLAG
        chunks.append(bytes([header]) + piece)
    return chunks


class Reassembler:
    """Feed chunks in; get a complete message back when the last one arrives."""

    def __init__(self) -> None:
        self._buffer = bytearray()
        self._expected_seq = 0
        self.dropped = 0

    def feed(self, chunk: bytes) -> Optional[str]:
        if not chunk:
            return None
        header = chunk[0]
        seq = header & SEQ_MASK
        last = bool(header & LAST_FLAG)

        if seq != self._expected_seq:
            # Lost or reordered chunk. Drop what we had and resync on a new message.
            if self._buffer or self._expected_seq != 0:
                self.dropped += 1
            self._buffer = bytearray()
            self._expected_seq = 0
            if seq != 0:
                return None

        self._buffer.extend(chunk[1:])
        self._expected_seq = (seq + 1) & SEQ_MASK

        if not last:
            return None
        message = self._buffer.decode("utf-8", errors="replace")
        self._buffer = bytearray()
        self._expected_seq = 0
        return message
