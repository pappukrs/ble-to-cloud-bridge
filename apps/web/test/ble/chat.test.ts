import { describe, it, expect, vi } from 'vitest';
import { encodeChunks, CHAT_SERVICE_UUID } from '@ble-bridge/shared';
import { connectChat } from '../../src/ble/chat';
import { BleUnavailableError } from '../../src/ble/client';
import { FakeChatDevice } from './fakeChatDevice';

const text = (c: Uint8Array) => new TextDecoder().decode(c.subarray(1));

describe('connectChat', () => {
  it('throws when Web Bluetooth is missing', async () => {
    await expect(connectChat({ onMessage: vi.fn() })).rejects.toBeInstanceOf(BleUnavailableError);
  });

  it('finds the laptop by chat service uuid and subscribes to outbox', async () => {
    const dev = new FakeChatDevice();
    const bt = dev.bluetooth();
    const link = await connectChat({ bluetooth: bt, onMessage: vi.fn() });
    expect(bt.requestDevice).toHaveBeenCalledWith({ filters: [{ services: [CHAT_SERVICE_UUID] }] });
    expect(dev.outbox.startNotifications).toHaveBeenCalled();
    expect(link.peerName).toBe('ble-chat');
  });

  it('writes a short message as one chunk with the last flag', async () => {
    const dev = new FakeChatDevice();
    const link = await connectChat({ bluetooth: dev.bluetooth(), onMessage: vi.fn() });
    const count = await link.send('hi');
    expect(count).toBe(1);
    expect(dev.written).toHaveLength(1);
    expect(dev.written[0]![0]).toBe(0x80);
    expect(text(dev.written[0]!)).toBe('hi');
  });

  it('splits a long message into 19-byte payload chunks by default', async () => {
    const dev = new FakeChatDevice();
    const link = await connectChat({ bluetooth: dev.bluetooth(), onMessage: vi.fn() });
    const message = 'a'.repeat(45);
    expect(await link.send(message)).toBe(3);
    expect(dev.written.map((c) => c.length)).toEqual([20, 20, 8]);
    expect(dev.written.map((c) => c[0])).toEqual([0x00, 0x01, 0x82]);
  });

  it('uses a larger payload when an mtu is given', async () => {
    const dev = new FakeChatDevice();
    const link = await connectChat({ bluetooth: dev.bluetooth(), onMessage: vi.fn(), mtu: 100 });
    expect(await link.send('a'.repeat(45))).toBe(1);
  });

  it('sends two messages in order without interleaving chunks', async () => {
    const dev = new FakeChatDevice();
    const link = await connectChat({ bluetooth: dev.bluetooth(), onMessage: vi.fn() });
    await Promise.all([link.send('a'.repeat(30)), link.send('b'.repeat(30))]);
    const firstBytes = dev.written.slice(0, 2).map(text).join('');
    const secondBytes = dev.written.slice(2).map(text).join('');
    expect(firstBytes).toBe('a'.repeat(30));
    expect(secondBytes).toBe('b'.repeat(30));
  });

  it('reassembles incoming chunks and delivers whole messages', async () => {
    const dev = new FakeChatDevice();
    const onMessage = vi.fn();
    await connectChat({ bluetooth: dev.bluetooth(), onMessage });
    for (const c of encodeChunks('hello from the laptop', 5)) dev.notifyChunk(c);
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith('hello from the laptop');
  });

  it('reports disconnects', async () => {
    const dev = new FakeChatDevice();
    const onDisconnect = vi.fn();
    const link = await connectChat({
      bluetooth: dev.bluetooth(),
      onMessage: vi.fn(),
      onDisconnect,
    });
    link.disconnect();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });
});
