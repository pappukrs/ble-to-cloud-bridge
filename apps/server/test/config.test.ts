import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('throws when AUTH_TOKEN is missing', () => {
    expect(() => loadConfig({})).toThrow(/AUTH_TOKEN/);
  });
  it('applies defaults', () => {
    const cfg = loadConfig({ AUTH_TOKEN: 't' });
    expect(cfg).toEqual({
      port: 8080,
      authToken: 't',
      maxPayloadBytes: 1024,
      helloTimeoutMs: 5000,
    });
  });
  it('reads overrides', () => {
    const cfg = loadConfig({ AUTH_TOKEN: 't', PORT: '9000', MAX_PAYLOAD_BYTES: '64' });
    expect(cfg.port).toBe(9000);
    expect(cfg.maxPayloadBytes).toBe(64);
  });
});
