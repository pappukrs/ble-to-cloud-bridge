import { describe, it, expect } from 'vitest';
import { parseMessage, serializeMessage, ReadingMessage, type Message } from '../src';

describe('parseMessage', () => {
  it('accepts a valid hello', () => {
    const result = parseMessage('{"type":"hello","role":"bridge","token":"abc"}');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe('hello');
    }
  });

  it('accepts a valid reading', () => {
    const raw = JSON.stringify({ type: 'reading', source: 'ble', value: '42', ts: 1700000000000 });
    const result = parseMessage(raw);
    expect(result).toEqual({
      ok: true,
      message: { type: 'reading', source: 'ble', value: '42', ts: 1700000000000 },
    });
  });

  it('rejects malformed JSON without throwing', () => {
    expect(parseMessage('{not json')).toEqual({ ok: false, reason: 'not valid JSON' });
  });

  it('rejects an unknown type', () => {
    const result = parseMessage('{"type":"bogus"}');
    expect(result.ok).toBe(false);
  });

  it('rejects a hello with an empty token', () => {
    const result = parseMessage('{"type":"hello","role":"dashboard","token":""}');
    expect(result.ok).toBe(false);
  });

  it('rejects a reading with a negative timestamp', () => {
    const result = parseMessage('{"type":"reading","source":"ble","value":"x","ts":-1}');
    expect(result.ok).toBe(false);
  });

  it('rejects a reading whose value is not a string', () => {
    const result = parseMessage('{"type":"reading","source":"ble","value":42,"ts":1}');
    expect(result.ok).toBe(false);
  });
});

describe('serializeMessage', () => {
  it('round-trips through parseMessage', () => {
    const msg: Message = { type: 'welcome', clientId: 'c1', peers: 2 };
    const result = parseMessage(serializeMessage(msg));
    expect(result).toEqual({ ok: true, message: msg });
  });
});

describe('ReadingMessage schema', () => {
  it('strips nothing and keeps optional fields when present', () => {
    const parsed = ReadingMessage.parse({
      type: 'reading',
      source: 'ble',
      deviceName: 'nRF',
      value: '7',
      rssi: -60,
      ts: 5,
    });
    expect(parsed.deviceName).toBe('nRF');
    expect(parsed.rssi).toBe(-60);
  });
});
