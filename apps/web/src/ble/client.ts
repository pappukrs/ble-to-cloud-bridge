import { BLE_SERVICE_UUID, BLE_CHARACTERISTIC_UUID } from './constants';

/** A decoded value from the phone plus where it came from. */
export interface BleReading {
  value: string;
  deviceName?: string;
  ts: number;
}

export interface BleConnection {
  deviceName: string | undefined;
  /** Write a UTF-8 string to the characteristic. */
  write(value: string): Promise<void>;
  /** Read the characteristic once. */
  read(): Promise<string>;
  disconnect(): void;
}

export interface BleClientOptions {
  /** Injected for tests. Defaults to the real navigator.bluetooth. */
  bluetooth?: Bluetooth;
  serviceUuid?: string;
  characteristicUuid?: string;
  onReading: (reading: BleReading) => void;
  onDisconnect?: () => void;
  now?: () => number;
}

export class BleUnavailableError extends Error {
  constructor() {
    super(
      'Web Bluetooth is not available. Use Chrome or Edge on desktop or Android, over https:// or localhost.',
    );
    this.name = 'BleUnavailableError';
  }
}

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export function isBluetoothAvailable(nav: Navigator = navigator): boolean {
  return typeof nav.bluetooth !== 'undefined';
}

/**
 * Pair with a phone advertising our service and subscribe to its characteristic.
 *
 * Must be called from inside a user gesture (a click handler): the browser
 * refuses to show the device chooser otherwise.
 *
 * Flow (this is the GATT model in code):
 *   requestDevice  -> user picks a peripheral from the chooser
 *   gatt.connect   -> open the connection (we are the central)
 *   getPrimaryService / getCharacteristic -> walk the GATT tree
 *   readValue      -> one-shot read
 *   startNotifications -> phone pushes every change to us
 */
export async function connectBle(options: BleClientOptions): Promise<BleConnection> {
  const bluetooth = options.bluetooth ?? (navigator as Navigator).bluetooth;
  if (!bluetooth) throw new BleUnavailableError();

  const serviceUuid = options.serviceUuid ?? BLE_SERVICE_UUID;
  const characteristicUuid = options.characteristicUuid ?? BLE_CHARACTERISTIC_UUID;
  const now = options.now ?? Date.now;

  const device = await bluetooth.requestDevice({ filters: [{ services: [serviceUuid] }] });
  if (!device.gatt) throw new Error('Device has no GATT server');

  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(serviceUuid);
  const characteristic = await service.getCharacteristic(characteristicUuid);

  const emit = (view: DataView | undefined) => {
    if (!view) return;
    const reading: BleReading = { value: decoder.decode(view), ts: now() };
    if (device.name) reading.deviceName = device.name;
    options.onReading(reading);
  };

  // Initial read so the UI shows something before the first notify.
  emit(await characteristic.readValue());

  await characteristic.startNotifications();
  characteristic.addEventListener('characteristicvaluechanged', (event) => {
    emit((event.target as BluetoothRemoteGATTCharacteristic).value);
  });

  device.addEventListener('gattserverdisconnected', () => {
    options.onDisconnect?.();
  });

  return {
    deviceName: device.name,
    write: async (value) => {
      await characteristic.writeValue(encoder.encode(value));
    },
    read: async () => decoder.decode(await characteristic.readValue()),
    disconnect: () => {
      if (device.gatt?.connected) device.gatt.disconnect();
    },
  };
}
