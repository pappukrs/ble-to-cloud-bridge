import { describe, it, expect, vi } from 'vitest';
import {
  encodeChunks,
  encodeEnvelope,
  decodeEnvelope,
  CHAT_SERVICE_UUID,
} from '@ble-bridge/shared';
import { connectChat } from '../../src/ble/chat';
import { BleUnavailableError } from '../../src/ble/client';
import { FakeChatDevice } from './fakeChatDevice';

const me = { id: 'me000001', name: 'Asha' };
const writtenText = (dev: FakeChatDevice) =>
  new TextDecoder().decode(
    dev.written.reduce((acc, c) => new Uint8Array([...acc, ...c.subarray(1)]), new Uint8Array()),
  );

describe('connectChat', () => {
  it('throws when Web Bluetooth is missing', async () => {
    await expect(connectChat({ ...me, onMessage: vi.fn() })).rejects.toBeInstanceOf(
      BleUnavailableError,
    );
  });

  it('finds the laptop by chat service uuid and subscribes to outbox', async () => {
    const dev = new FakeChatDevice();
    const bt = dev.bluetooth();
    const link = await connectChat({ ...me, bluetooth: bt, onMessage: vi.fn() });
    expect(bt.requestDevice).toHaveBeenCalledWith({ filters: [{ services: [CHAT_SERVICE_UUID] }] });
    expect(dev.outbox.startNotifications).toHaveBeenCalled();
    expect(link.peerName).toBe('ble-chat');
  });

  it('writes an envelope with id, name, text and time', async () => {
    const dev = new FakeChatDevice();
    const link = await connectChat({
      ...me,
      bluetooth: dev.bluetooth(),
      onMessage: vi.fn(),
      now: () => 77,
    });
    const sent = await link.send('hi');
    expect(sent).toEqual({ id: 'me000001', from: 'Asha', text: 'hi', ts: 77 });
    expect(decodeEnvelope(writtenText(dev))).toEqual(sent);
    expect(dev.written.every((c) => c.length <= 20)).toBe(true);
    expect(dev.written.at(-1)![0]! & 0x80).toBe(0x80);
  });

  it('uses a larger payload when an mtu is given', async () => {
    const dev = new FakeChatDevice();
    const link = await connectChat({
      ...me,
      bluetooth: dev.bluetooth(),
      onMessage: vi.fn(),
      mtu: 517,
    });
    await link.send('a'.repeat(200));
    expect(dev.written).toHaveLength(1);
  });

  it('sends two messages in order without interleaving chunks', async () => {
    const dev = new FakeChatDevice();
    const link = await connectChat({
      ...me,
      bluetooth: dev.bluetooth(),
      onMessage: vi.fn(),
      now: () => 1,
    });
    await Promise.all([link.send('a'.repeat(30)), link.send('b'.repeat(30))]);
    const all = writtenText(dev);
    expect(all.indexOf('a'.repeat(30))).toBeLessThan(all.indexOf('b'.repeat(30)));
  });

  it('delivers envelopes from others and drops its own echo', async () => {
    const dev = new FakeChatDevice();
    const onMessage = vi.fn();
    await connectChat({ ...me, bluetooth: dev.bluetooth(), onMessage });
    const other = { id: 'p2', from: 'Ravi', text: 'hello from Ravi', ts: 5 };
    const echo = { id: 'me000001', from: 'Asha', text: 'my own', ts: 6 };
    for (const c of encodeChunks(encodeEnvelope(other), 5)) dev.notifyChunk(c);
    for (const c of encodeChunks(encodeEnvelope(echo), 5)) dev.notifyChunk(c);
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledWith(other);
  });

  it('ignores malformed incoming text', async () => {
    const dev = new FakeChatDevice();
    const onMessage = vi.fn();
    await connectChat({ ...me, bluetooth: dev.bluetooth(), onMessage });
    for (const c of encodeChunks('not json', 5)) dev.notifyChunk(c);
    expect(onMessage).not.toHaveBeenCalled();
  });

  it('reports disconnects', async () => {
    const dev = new FakeChatDevice();
    const onDisconnect = vi.fn();
    const link = await connectChat({
      ...me,
      bluetooth: dev.bluetooth(),
      onMessage: vi.fn(),
      onDisconnect,
    });
    link.disconnect();
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });
});
