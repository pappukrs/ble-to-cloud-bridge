import { describe, it, expect, vi } from 'vitest';
import { Relay, type RelaySocket } from '../src/relay';

function fakeSocket(open = true): RelaySocket & { send: ReturnType<typeof vi.fn> } {
  return { isOpen: open, send: vi.fn(), close: vi.fn() };
}

describe('Relay', () => {
  it('assigns unique ids and counts peers', () => {
    const relay = new Relay();
    const a = relay.add('bridge', fakeSocket());
    const b = relay.add('dashboard', fakeSocket());
    expect(a.id).not.toBe(b.id);
    expect(relay.size()).toBe(2);
  });

  it('broadcasts to everyone except the sender', () => {
    const relay = new Relay();
    const sender = fakeSocket();
    const d1 = fakeSocket();
    const d2 = fakeSocket();
    const s = relay.add('bridge', sender);
    relay.add('dashboard', d1);
    relay.add('dashboard', d2);

    const delivered = relay.broadcast(s.id, { type: 'reading', source: 'ble', value: '1', ts: 1 });

    expect(delivered).toBe(2);
    expect(sender.send).not.toHaveBeenCalled();
    expect(d1.send).toHaveBeenCalledWith('{"type":"reading","source":"ble","value":"1","ts":1}');
    expect(d2.send).toHaveBeenCalledTimes(1);
  });

  it('skips sockets that are not open', () => {
    const relay = new Relay();
    const s = relay.add('bridge', fakeSocket());
    const closed = fakeSocket(false);
    relay.add('dashboard', closed);

    const delivered = relay.broadcast(s.id, { type: 'reading', source: 'ble', value: '1', ts: 1 });

    expect(delivered).toBe(0);
    expect(closed.send).not.toHaveBeenCalled();
  });

  it('stops delivering to removed peers', () => {
    const relay = new Relay();
    const s = relay.add('bridge', fakeSocket());
    const d = fakeSocket();
    const p = relay.add('dashboard', d);
    relay.remove(p.id);

    relay.broadcast(s.id, { type: 'reading', source: 'ble', value: '1', ts: 1 });

    expect(d.send).not.toHaveBeenCalled();
    expect(relay.size()).toBe(1);
  });
});
