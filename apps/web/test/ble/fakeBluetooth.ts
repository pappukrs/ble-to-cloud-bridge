import { vi } from 'vitest';

/**
 * A hand-written fake of the small slice of Web Bluetooth we use.
 * It behaves like the real thing (events, connected flag) so tests exercise
 * our logic, not just assert that mocks were called.
 */
export class FakeCharacteristic extends EventTarget {
  value: DataView | undefined;
  readValue = vi.fn(async () => this.value ?? new DataView(new ArrayBuffer(0)));
  writeValue = vi.fn(async (data: BufferSource) => {
    this.value = new DataView(data instanceof ArrayBuffer ? data : data.buffer.slice(0));
  });
  startNotifications = vi.fn(async () => this);

  setText(text: string): void {
    this.value = new DataView(new TextEncoder().encode(text).buffer);
  }

  /** Simulate the phone changing the value and pushing a notification. */
  notify(text: string): void {
    this.setText(text);
    const event = new Event('characteristicvaluechanged');
    this.dispatchEvent(event);
  }
}

export class FakeGattServer {
  connected = false;
  constructor(
    private readonly device: FakeDevice,
    readonly characteristic: FakeCharacteristic,
  ) {}
  connect = vi.fn(async () => {
    this.connected = true;
    return this;
  });
  disconnect = vi.fn(() => {
    this.connected = false;
    this.device.dispatchEvent(new Event('gattserverdisconnected'));
  });
  getPrimaryService = vi.fn(async (_uuid: string) => ({
    getCharacteristic: vi.fn(async (_cuuid: string) => this.characteristic),
  }));
}

export class FakeDevice extends EventTarget {
  gatt: FakeGattServer;
  constructor(
    readonly name: string | undefined,
    characteristic = new FakeCharacteristic(),
  ) {
    super();
    this.gatt = new FakeGattServer(this, characteristic);
  }
}

export function fakeBluetooth(device: FakeDevice) {
  return {
    requestDevice: vi.fn(async () => device),
  } as unknown as Bluetooth & { requestDevice: ReturnType<typeof vi.fn> };
}
