import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WsClient } from '../../src/ws/client';
import { FakeWebSocket, FakeWS } from './fakeWebSocket';

const reading = { type: 'reading', source: 'ble', value: '1', ts: 1 } as const;

function makeClient(overrides: Partial<ConstructorParameters<typeof WsClient>[0]> = {}) {
  const timers: Array<{ fn: () => void; ms: number }> = [];
  const onMessage = vi.fn();
  const onStatus = vi.fn();
  const client = new WsClient({
    url: 'ws://test',
    token: 'tok',
    role: 'bridge',
    onMessage,
    onStatus,
    WebSocketImpl: FakeWS,
    schedule: (fn, ms) => timers.push({ fn, ms }),
    minBackoffMs: 100,
    maxBackoffMs: 400,
    ...overrides,
  });
  return { client, timers, onMessage, onStatus, socket: () => FakeWebSocket.instances.at(-1)! };
}

beforeEach(() => FakeWebSocket.reset());

describe('WsClient', () => {
  it('sends hello as soon as the socket opens', () => {
    const { client, socket } = makeClient();
    client.connect();
    socket().serverOpen();
    expect(socket().sent).toEqual(['{"type":"hello","role":"bridge","token":"tok"}']);
  });

  it('reports connecting then open after welcome', () => {
    const { client, socket, onStatus } = makeClient();
    client.connect();
    socket().serverOpen();
    socket().serverSend({ type: 'welcome', clientId: 'c1', peers: 0 });
    expect(onStatus.mock.calls.map((c) => c[0])).toEqual(['connecting', 'open']);
    expect(client.status).toBe('open');
  });

  it('queues readings until welcomed, then flushes in order', () => {
    const { client, socket } = makeClient();
    client.connect();
    client.sendReading({ ...reading, value: 'a' });
    client.sendReading({ ...reading, value: 'b' });
    expect(client.queued).toBe(2);

    socket().serverOpen();
    socket().serverSend({ type: 'welcome', clientId: 'c1', peers: 0 });

    expect(client.queued).toBe(0);
    expect(socket().sent.slice(1)).toEqual([
      JSON.stringify({ ...reading, value: 'a' }),
      JSON.stringify({ ...reading, value: 'b' }),
    ]);
  });

  it('sends immediately once open', () => {
    const { client, socket } = makeClient();
    client.connect();
    socket().serverOpen();
    socket().serverSend({ type: 'welcome', clientId: 'c1', peers: 0 });
    client.sendReading(reading);
    expect(socket().sent.at(-1)).toBe(JSON.stringify(reading));
  });

  it('forwards parsed messages and ignores junk', () => {
    const { client, socket, onMessage } = makeClient();
    client.connect();
    socket().serverOpen();
    socket().serverSend(reading);
    socket().onmessage?.({ data: '{nope' });
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(reading);
  });

  it('reconnects with exponential backoff capped at max', () => {
    const { client, socket, timers } = makeClient();
    client.connect();
    socket().serverClose(1006);
    expect(timers.map((t) => t.ms)).toEqual([100]);
    timers[0]!.fn();
    socket().serverClose(1006);
    timers[1]!.fn();
    socket().serverClose(1006);
    timers[2]!.fn();
    socket().serverClose(1006);
    expect(timers.map((t) => t.ms)).toEqual([100, 200, 400, 400]);
    expect(FakeWebSocket.instances).toHaveLength(4);
  });

  it('resets backoff after a successful welcome', () => {
    const { client, socket, timers } = makeClient();
    client.connect();
    socket().serverClose(1006);
    timers[0]!.fn();
    socket().serverClose(1006);
    timers[1]!.fn();
    socket().serverOpen();
    socket().serverSend({ type: 'welcome', clientId: 'c1', peers: 0 });
    socket().serverClose(1006);
    expect(timers.map((t) => t.ms)).toEqual([100, 200, 100]);
  });

  it('does not reconnect after an unauthorized close', () => {
    const { client, socket, timers, onStatus } = makeClient();
    client.connect();
    socket().serverClose(4003);
    expect(timers).toHaveLength(0);
    expect(client.status).toBe('unauthorized');
    expect(onStatus).toHaveBeenLastCalledWith('unauthorized');
  });

  it('does not reconnect after close() is called', () => {
    const { client, socket, timers } = makeClient();
    client.connect();
    const first = socket();
    client.close();
    expect(first.readyState).toBe(FakeWebSocket.CLOSED);
    expect(timers).toHaveLength(0);
    expect(client.status).toBe('closed');
  });
});
