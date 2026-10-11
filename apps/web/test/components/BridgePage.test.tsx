import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BridgePage } from '../../src/pages/BridgePage';
import { FakeWebSocket, FakeWS } from '../ws/fakeWebSocket';
import { FakeDevice, fakeBluetooth } from '../ble/fakeBluetooth';

beforeEach(() => FakeWebSocket.reset());

describe('BridgePage', () => {
  it('connects to BLE on click and forwards notifications to the relay', async () => {
    const user = userEvent.setup();
    const device = new FakeDevice('nRF Phone');
    device.gatt.characteristic.setText('36.6');
    render(
      <BridgePage
        wsUrl="ws://t"
        wsToken="tok"
        bluetooth={fakeBluetooth(device)}
        WebSocketImpl={FakeWS}
      />,
    );
    const sock = FakeWebSocket.instances[0]!;
    act(() => {
      sock.serverOpen();
      sock.serverSend({ type: 'welcome', clientId: 'c1', peers: 0 });
    });

    await user.click(screen.getByRole('button', { name: 'Connect BLE' }));

    expect(screen.getByText(/BLE: connected to/)).toHaveTextContent('nRF Phone');
    expect(screen.getByTestId('latest-value')).toHaveTextContent('36.6');
    const first = JSON.parse(sock.sent[1]!);
    expect(first).toMatchObject({
      type: 'reading',
      source: 'ble',
      value: '36.6',
      deviceName: 'nRF Phone',
    });

    act(() => device.gatt.characteristic.notify('37.1'));
    expect(screen.getByTestId('latest-value')).toHaveTextContent('37.1');
    expect(JSON.parse(sock.sent[2]!)).toMatchObject({ value: '37.1' });
  });

  it('writes a value to the phone', async () => {
    const user = userEvent.setup();
    const device = new FakeDevice('p');
    render(
      <BridgePage
        wsUrl="ws://t"
        wsToken="tok"
        bluetooth={fakeBluetooth(device)}
        WebSocketImpl={FakeWS}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Connect BLE' }));
    await user.type(screen.getByLabelText('value to write'), 'LED_ON');
    await user.click(screen.getByRole('button', { name: 'Write' }));
    expect(device.gatt.characteristic.writeValue).toHaveBeenCalledTimes(1);
    expect(new TextDecoder().decode(device.gatt.characteristic.value)).toBe('LED_ON');
  });

  it('returns to the connect button when the phone disconnects', async () => {
    const user = userEvent.setup();
    const device = new FakeDevice('p');
    render(
      <BridgePage
        wsUrl="ws://t"
        wsToken="tok"
        bluetooth={fakeBluetooth(device)}
        WebSocketImpl={FakeWS}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Connect BLE' }));
    await user.click(screen.getByRole('button', { name: 'Disconnect BLE' }));
    expect(screen.getByRole('button', { name: 'Connect BLE' })).toBeInTheDocument();
  });

  it('disables the button and explains when Web Bluetooth is missing', () => {
    render(<BridgePage wsUrl="ws://t" wsToken="tok" WebSocketImpl={FakeWS} />);
    expect(screen.getByRole('button', { name: 'Connect BLE' })).toBeDisabled();
    expect(screen.getByText(/Web Bluetooth is not available/)).toBeInTheDocument();
  });
});
