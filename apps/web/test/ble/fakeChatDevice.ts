import { vi } from 'vitest';
import { CHAT_INBOX_UUID, CHAT_OUTBOX_UUID } from '@ble-bridge/shared';
import { FakeCharacteristic } from './fakeBluetooth';

/** A fake laptop peripheral with inbox (write) and outbox (notify) characteristics. */
export class FakeChatDevice extends EventTarget {
  inbox = new FakeCharacteristic();
  outbox = new FakeCharacteristic();
  /** Every chunk the phone wrote, in order. */
  written: Uint8Array[] = [];
  gatt = {
    connected: false,
    connect: vi.fn(async () => {
      this.gatt.connected = true;
      return this.gatt;
    }),
    disconnect: vi.fn(() => {
      this.gatt.connected = false;
      this.dispatchEvent(new Event('gattserverdisconnected'));
    }),
    getPrimaryService: vi.fn(async () => ({
      getCharacteristic: vi.fn(async (uuid: string) => {
        if (uuid === CHAT_INBOX_UUID) return this.inbox;
        if (uuid === CHAT_OUTBOX_UUID) return this.outbox;
        throw new Error(`unknown characteristic ${uuid}`);
      }),
    })),
  };

  constructor(readonly name: string | undefined = 'ble-chat') {
    super();
    this.inbox.writeValueWithResponse = vi.fn(async (data: BufferSource) => {
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      this.written.push(new Uint8Array(bytes));
    }) as unknown as FakeCharacteristic['writeValueWithResponse'];
  }

  /** Simulate the laptop notifying one raw chunk. */
  notifyChunk(chunk: Uint8Array): void {
    this.outbox.value = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    this.outbox.dispatchEvent(new Event('characteristicvaluechanged'));
  }

  bluetooth() {
    return { requestDevice: vi.fn(async () => this) } as unknown as Bluetooth;
  }
}
