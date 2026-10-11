import { describe, it, expect } from 'vitest';
import { ChunkReassembler, encodeChunks, payloadSizeForMtu } from '../src';

const bytes = (...xs: number[]) => new Uint8Array(xs);
const text = (s: string) => Array.from(new TextEncoder().encode(s));

describe('encodeChunks', () => {
  it('puts a short message in one last chunk', () => {
    expect(encodeChunks('hi', 19)).toEqual([bytes(0x80, ...text('hi'))]);
  });

  it('encodes an empty message as one empty last chunk', () => {
    expect(encodeChunks('', 19)).toEqual([bytes(0x80)]);
  });

  it('splits a long message with sequence numbers', () => {
    expect(encodeChunks('abcdefgh', 3)).toEqual([
      bytes(0x00, ...text('abc')),
      bytes(0x01, ...text('def')),
      bytes(0x82, ...text('gh')),
    ]);
  });

  it('wraps the sequence at 128', () => {
    const chunks = encodeChunks('x'.repeat(130), 1);
    expect(chunks[127]![0]).toBe(127);
    expect(chunks[128]![0]).toBe(0);
    expect(chunks[129]![0]).toBe(0x81);
  });

  it('rejects payload size below 1', () => {
    expect(() => encodeChunks('x', 0)).toThrow(RangeError);
  });
});

describe('payloadSizeForMtu', () => {
  it('matches the Python implementation', () => {
    expect(payloadSizeForMtu(23)).toBe(19);
    expect(payloadSizeForMtu(517)).toBe(513);
    expect(payloadSizeForMtu(4)).toBe(1);
  });
});

describe('ChunkReassembler', () => {
  const messages = ['', 'a', 'hello world', 'नमस्ते दुनिया 🙂', 'x'.repeat(500)];
  for (const payloadSize of [1, 3, 19, 100]) {
    for (const message of messages) {
      it(`round-trips ${JSON.stringify(message.slice(0, 12))} with payload ${payloadSize}`, () => {
        const r = new ChunkReassembler();
        const out = encodeChunks(message, payloadSize).map((c) => r.feed(c));
        expect(out.slice(0, -1).every((x) => x === null)).toBe(true);
        expect(out.at(-1)).toBe(message);
        expect(r.dropped).toBe(0);
      });
    }
  }

  it('handles two messages back to back', () => {
    const r = new ChunkReassembler();
    const chunks = [...encodeChunks('first', 3), ...encodeChunks('second', 3)];
    const got = chunks.map((c) => r.feed(c)).filter((m) => m !== null);
    expect(got).toEqual(['first', 'second']);
  });

  it('drops a message with a missing chunk and resyncs', () => {
    const r = new ChunkReassembler();
    const chunks = encodeChunks('abcdefgh', 3);
    expect(r.feed(chunks[0]!)).toBeNull();
    expect(r.feed(chunks[2]!)).toBeNull();
    expect(r.dropped).toBe(1);
    expect(r.feed(bytes(0x80, ...text('ok')))).toBe('ok');
  });

  it('reassembles a UTF-8 code point split across chunks', () => {
    const r = new ChunkReassembler();
    let out: string | null = null;
    for (const c of encodeChunks('🙂🙂', 3)) out = r.feed(c) ?? out;
    expect(out).toBe('🙂🙂');
  });

  it('ignores an empty chunk', () => {
    expect(new ChunkReassembler().feed(new Uint8Array(0))).toBeNull();
  });

  it('decodes chunks produced by the Python encoder', () => {
    // Captured from: encode("hello world", 4) in apps/peripheral
    const fromPython = [
      bytes(0x00, 104, 101, 108, 108),
      bytes(0x01, 111, 32, 119, 111),
      bytes(0x82, 114, 108, 100),
    ];
    const r = new ChunkReassembler();
    const out = fromPython.map((c) => r.feed(c));
    expect(out).toEqual([null, null, 'hello world']);
  });
});
