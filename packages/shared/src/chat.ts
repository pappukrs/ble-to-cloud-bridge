/**
 * Bluetooth-only chat: UUIDs and the chunked message transport.
 *
 * Mirrors apps/peripheral/src/ble_chat/chunk.py and uuids.py. Keep both in sync.
 *
 * A single BLE write or notification carries at most MTU-3 bytes (20 with the
 * default MTU of 23). A chat message can be longer, so it is split into chunks:
 *
 *   byte 0      : header
 *                   bit 7     = 1 on the last chunk of a message
 *                   bits 0..6 = sequence number, 0 for the first chunk, wraps at 128
 *   bytes 1..n  : UTF-8 payload
 */

export const CHAT_SERVICE_UUID = '7a0b1000-6f6c-4c3a-9d2e-0123456789ab';
/** phone -> laptop (write) */
export const CHAT_INBOX_UUID = '7a0b1001-6f6c-4c3a-9d2e-0123456789ab';
/** laptop -> phone (notify) */
export const CHAT_OUTBOX_UUID = '7a0b1002-6f6c-4c3a-9d2e-0123456789ab';
export const CHAT_LOCAL_NAME = 'ble-chat';

const LAST_FLAG = 0x80;
const SEQ_MASK = 0x7f;
const HEADER_SIZE = 1;
const MIN_PAYLOAD_SIZE = 1;
export const DEFAULT_MTU = 23;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

/** Usable payload bytes per chunk for a negotiated ATT MTU. */
export function payloadSizeForMtu(mtu: number): number {
  return Math.max(MIN_PAYLOAD_SIZE, mtu - 3 - HEADER_SIZE);
}

/** Split a message into wire chunks. An empty message is one empty last chunk. */
export function encodeChunks(message: string, payloadSize: number): Uint8Array[] {
  if (payloadSize < MIN_PAYLOAD_SIZE) throw new RangeError('payloadSize must be at least 1');
  const data = encoder.encode(message);
  const pieceCount = Math.max(1, Math.ceil(data.length / payloadSize));
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < pieceCount; index++) {
    const piece = data.subarray(index * payloadSize, (index + 1) * payloadSize);
    let header = index & SEQ_MASK;
    if (index === pieceCount - 1) header |= LAST_FLAG;
    const chunk = new Uint8Array(1 + piece.length);
    chunk[0] = header;
    chunk.set(piece, 1);
    chunks.push(chunk);
  }
  return chunks;
}

/** Feed chunks in; get a complete message back when the last one arrives. */
export class ChunkReassembler {
  private parts: Uint8Array[] = [];
  private expectedSeq = 0;
  dropped = 0;

  feed(chunk: Uint8Array): string | null {
    if (chunk.length === 0) return null;
    const header = chunk[0]!;
    const seq = header & SEQ_MASK;
    const last = (header & LAST_FLAG) !== 0;

    if (seq !== this.expectedSeq) {
      // Lost or reordered chunk. Drop what we had and resync on a new message.
      if (this.parts.length > 0 || this.expectedSeq !== 0) this.dropped++;
      this.parts = [];
      this.expectedSeq = 0;
      if (seq !== 0) return null;
    }

    this.parts.push(chunk.subarray(1));
    this.expectedSeq = (seq + 1) & SEQ_MASK;

    if (!last) return null;
    const total = this.parts.reduce((n, p) => n + p.length, 0);
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const p of this.parts) {
      joined.set(p, offset);
      offset += p.length;
    }
    this.parts = [];
    this.expectedSeq = 0;
    return decoder.decode(joined);
  }
}
