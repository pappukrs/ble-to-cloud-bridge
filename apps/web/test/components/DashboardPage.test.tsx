import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { DashboardPage } from '../../src/pages/DashboardPage';
import { FakeWebSocket, FakeWS } from '../ws/fakeWebSocket';

beforeEach(() => FakeWebSocket.reset());

describe('DashboardPage', () => {
  it('connects as a dashboard and shows relayed readings newest first', () => {
    render(<DashboardPage wsUrl="ws://t" wsToken="tok" WebSocketImpl={FakeWS} />);
    expect(screen.getByRole('status')).toHaveTextContent('Connecting');

    const sock = FakeWebSocket.instances[0]!;
    act(() => {
      sock.serverOpen();
      sock.serverSend({ type: 'welcome', clientId: 'c2', peers: 1 });
    });
    expect(sock.sent[0]).toBe('{"type":"hello","role":"dashboard","token":"tok"}');
    expect(screen.getByRole('status')).toHaveTextContent('Connected');

    act(() => {
      sock.serverSend({ type: 'reading', source: 'ble', value: '20', ts: 1 });
      sock.serverSend({ type: 'reading', source: 'ble', value: '21', ts: 2 });
    });
    expect(screen.getByTestId('latest-value')).toHaveTextContent('21');
    expect(screen.getByRole('list', { name: 'reading log' }).children).toHaveLength(2);
  });

  it('shows unauthorized when the relay rejects the token', () => {
    render(<DashboardPage wsUrl="ws://t" wsToken="bad" WebSocketImpl={FakeWS} />);
    act(() => FakeWebSocket.instances[0]!.serverClose(4003));
    expect(screen.getByRole('status')).toHaveTextContent('Unauthorized');
  });
});
