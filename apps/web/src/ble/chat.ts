import {
  CHAT_INBOX_UUID,
  CHAT_OUTBOX_UUID,
  CHAT_SERVICE_UUID,
  ChunkReassembler,
  DEFAULT_MTU,
  encodeChunks,
  payloadSizeForMtu,
} from '@ble-bridge/shared';
import { BleUnavailableError } from './client';

export interface ChatLink {
  peerName: string | undefined;
  /** Chunk, write, and return how many chunks were sent. */
  send(message: string): Promise<number>;
  disconnect(): void;
}

export interface ChatLinkOptions {
  /** Injected for tests. Defaults to the real navigator.bluetooth. */
  bluetooth?: Bluetooth;
  onMessage: (text: string) => void;
  onDisconnect?: () => void;
  /**
   * Web Bluetooth does not expose the negotiated MTU, so the sender picks a
   * conservative chunk size. 20 bytes is always safe; Android usually allows ~500.
   */
  mtu?: number;
}

/**
 * Phone side of the Bluetooth-only chat. The phone is the central: it finds the
 * laptop by service UUID, writes outgoing text into `inbox` in chunks, and
 * subscribes to `outbox` for incoming chunks.
 */
export async function connectChat(options: ChatLinkOptions): Promise<ChatLink> {
  const bluetooth = options.bluetooth ?? (navigator as Navigator).bluetooth;
  if (!bluetooth) throw new BleUnavailableError();
  const payloadSize = payloadSizeForMtu(options.mtu ?? DEFAULT_MTU);

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
    if (text !== null) options.onMessage(text);
  });

  device.addEventListener('gattserverdisconnected', () => options.onDisconnect?.());

  // Writes must be sequential: Web Bluetooth rejects a write while one is in flight.
  let queue: Promise<unknown> = Promise.resolve();

  return {
    peerName: device.name,
    send: (message) => {
      const chunks = encodeChunks(message, payloadSize);
      const run = queue.then(async () => {
        for (const chunk of chunks) await inbox.writeValueWithResponse(chunk.slice().buffer);
        return chunks.length;
      });
      queue = run.catch(() => undefined);
      return run;
    },
    disconnect: () => {
      if (device.gatt?.connected) device.gatt.disconnect();
    },
  };
}
