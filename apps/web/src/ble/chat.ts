import {
  CHAT_INBOX_UUID,
  CHAT_OUTBOX_UUID,
  CHAT_SERVICE_UUID,
  ChunkReassembler,
  DEFAULT_MTU,
  decodeEnvelope,
  encodeChunks,
  encodeEnvelope,
  payloadSizeForMtu,
  type ChatEnvelope,
} from '@ble-bridge/shared';
import { BleUnavailableError } from './client';

export interface ChatLink {
  peerName: string | undefined;
  /** Wrap in an envelope, chunk, write. Resolves with the envelope that was sent. */
  send(text: string): Promise<ChatEnvelope>;
  disconnect(): void;
}

export interface ChatLinkOptions {
  /** This participant's stable id and display name. */
  id: string;
  name: string;
  /** Injected for tests. Defaults to the real navigator.bluetooth. */
  bluetooth?: Bluetooth;
  /** Called for every envelope from someone else. Own echoes are filtered out. */
  onMessage: (envelope: ChatEnvelope) => void;
  onDisconnect?: () => void;
  /**
   * Web Bluetooth does not expose the negotiated MTU, so the sender picks a
   * conservative chunk size. 20 bytes is always safe; Android usually allows ~500.
   */
  mtu?: number;
  now?: () => number;
}

/**
 * Phone side of the Bluetooth-only chat. The phone is a central: it finds the
 * laptop hub by service UUID, writes outgoing envelopes into `inbox` in chunks,
 * and subscribes to `outbox` for envelopes the hub forwards from everyone.
 */
export async function connectChat(options: ChatLinkOptions): Promise<ChatLink> {
  const bluetooth = options.bluetooth ?? (navigator as Navigator).bluetooth;
  if (!bluetooth) throw new BleUnavailableError();
  const payloadSize = payloadSizeForMtu(options.mtu ?? DEFAULT_MTU);
  const now = options.now ?? Date.now;

  const device = await bluetooth.requestDevice({ filters: [{ services: [CHAT_SERVICE_UUID] }] });
  if (!device.gatt) throw new Error('Device has no GATT server');
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(CHAT_SERVICE_UUID);
  const inbox = await service.getCharacteristic(CHAT_INBOX_UUID);
  const outbox = await service.getCharacteristic(CHAT_OUTBOX_UUID);

  const reassembler = new ChunkReassembler();
  await outbox.startNotifications();
  outbox.addEventListener('characteristicvaluechanged', (event) => {
    const view = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!view) return;
    const text = reassembler.feed(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    if (text === null) return;
    const envelope = decodeEnvelope(text);
    if (envelope && envelope.id !== options.id) options.onMessage(envelope);
  });

  device.addEventListener('gattserverdisconnected', () => options.onDisconnect?.());

  // Writes must be sequential: Web Bluetooth rejects a write while one is in flight.
  let queue: Promise<unknown> = Promise.resolve();

  return {
    peerName: device.name,
    send: (text) => {
      const envelope: ChatEnvelope = { id: options.id, from: options.name, text, ts: now() };
      const chunks = encodeChunks(encodeEnvelope(envelope), payloadSize);
      const run = queue.then(async () => {
        for (const chunk of chunks) await inbox.writeValueWithResponse(chunk.slice().buffer);
        return envelope;
      });
      queue = run.catch(() => undefined);
      return run;
    },
    disconnect: () => {
      if (device.gatt?.connected) device.gatt.disconnect();
    },
  };
}
