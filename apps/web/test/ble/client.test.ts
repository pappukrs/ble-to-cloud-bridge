import { describe, it, expect, vi } from 'vitest';
import { connectBle, isBluetoothAvailable, BleUnavailableError } from '../../src/ble/client';
import { BLE_SERVICE_UUID, BLE_CHARACTERISTIC_UUID } from '../../src/ble/constants';
import { FakeDevice, fakeBluetooth } from './fakeBluetooth';

describe('isBluetoothAvailable', () => {
  it('is false when navigator.bluetooth is missing', () => {
    expect(isBluetoothAvailable({} as Navigator)).toBe(false);
  });
  it('is true when present', () => {
    expect(isBluetoothAvailable({ bluetooth: {} } as unknown as Navigator)).toBe(true);
  });
});

describe('connectBle', () => {
  it('throws BleUnavailableError when no bluetooth is provided and navigator lacks it', async () => {
    await expect(connectBle({ onReading: vi.fn() })).rejects.toBeInstanceOf(BleUnavailableError);
  });

  it('requests a device filtered by our service uuid', async () => {
    const device = new FakeDevice('nRF');
    const bluetooth = fakeBluetooth(device);
    await connectBle({ bluetooth, onReading: vi.fn() });
    expect(bluetooth.requestDevice).toHaveBeenCalledWith({
      filters: [{ services: [BLE_SERVICE_UUID] }],
    });
    expect(device.gatt.getPrimaryService).toHaveBeenCalledWith(BLE_SERVICE_UUID);
  });

  it('walks the GATT tree and emits the initial value', async () => {
    const device = new FakeDevice('nRF');
    device.gatt.characteristic.setText('21');
    const onReading = vi.fn();
    await connectBle({ bluetooth: fakeBluetooth(device), onReading, now: () => 1000 });

    expect(device.gatt.connect).toHaveBeenCalled();
    expect(onReading).toHaveBeenCalledWith({ value: '21', deviceName: 'nRF', ts: 1000 });
  });

  it('subscribes to notifications and emits each change', async () => {
    const device = new FakeDevice(undefined);
    const onReading = vi.fn();
    let t = 0;
    await connectBle({ bluetooth: fakeBluetooth(device), onReading, now: () => ++t });
    onReading.mockClear();

    device.gatt.characteristic.notify('22');
    device.gatt.characteristic.notify('23');

    expect(device.gatt.characteristic.startNotifications).toHaveBeenCalled();
    expect(onReading).toHaveBeenNthCalledWith(1, { value: '22', ts: 2 });
    expect(onReading).toHaveBeenNthCalledWith(2, { value: '23', ts: 3 });
  });

  it('writes UTF-8 bytes to the characteristic', async () => {
    const device = new FakeDevice('nRF');
    const conn = await connectBle({ bluetooth: fakeBluetooth(device), onReading: vi.fn() });
    await conn.write('hi');
    const written = device.gatt.characteristic.writeValue.mock.calls[0]?.[0] as Uint8Array;
    expect(Array.from(written)).toEqual([104, 105]);
    expect(await conn.read()).toBe('hi');
  });

  it('calls onDisconnect when the phone drops the link', async () => {
    const device = new FakeDevice('nRF');
    const onDisconnect = vi.fn();
    const conn = await connectBle({
      bluetooth: fakeBluetooth(device),
      onReading: vi.fn(),
      onDisconnect,
    });
    expect(conn.deviceName).toBe('nRF');
    conn.disconnect();
    expect(device.gatt.disconnect).toHaveBeenCalled();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  it('uses custom uuids when given', async () => {
    const device = new FakeDevice('x');
    await connectBle({
      bluetooth: fakeBluetooth(device),
      onReading: vi.fn(),
      serviceUuid: 'aaaa',
      characteristicUuid: 'bbbb',
    });
    expect(device.gatt.getPrimaryService).toHaveBeenCalledWith('aaaa');
    expect(BLE_CHARACTERISTIC_UUID).not.toBe('bbbb');
  });
});
