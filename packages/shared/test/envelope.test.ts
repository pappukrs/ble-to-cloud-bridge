import { describe, it, expect } from 'vitest';
import { decodeEnvelope, encodeEnvelope, newParticipantId, MAX_NAME_LENGTH } from '../src';

describe('envelope', () => {
  it('round-trips', () => {
    const e = { id: 'abc', from: 'Adheesh', text: 'hello', ts: 123 };
    expect(decodeEnvelope(encodeEnvelope(e))).toEqual(e);
  });

  it('produces the exact wire JSON the Python hub expects', () => {
    expect(encodeEnvelope({ id: 'x1', from: 'A', text: 'hi', ts: 5 })).toBe(
      '{"id":"x1","from":"A","text":"hi","ts":5}',
    );
  });

  it('rejects junk and missing fields', () => {
    expect(decodeEnvelope('nope')).toBeNull();
    expect(decodeEnvelope('null')).toBeNull();
    expect(decodeEnvelope('{"from":"A","text":"x","ts":1}')).toBeNull();
    expect(decodeEnvelope('{"id":"","from":"A","text":"x","ts":1}')).toBeNull();
    expect(decodeEnvelope('{"id":"a","from":"A","text":1,"ts":1}')).toBeNull();
    expect(decodeEnvelope('{"id":"a","from":"A","text":"x","ts":"1"}')).toBeNull();
  });

  it('truncates long names', () => {
    const e = decodeEnvelope(JSON.stringify({ id: 'a', from: 'n'.repeat(100), text: 't', ts: 1 }));
    expect(e?.from).toHaveLength(MAX_NAME_LENGTH);
  });

  it('makes 8-char ids', () => {
    expect(newParticipantId()).toMatch(/^[a-z0-9]{8}$/);
    expect(newParticipantId(() => 0)).toBe('aaaaaaaa');
  });
});
