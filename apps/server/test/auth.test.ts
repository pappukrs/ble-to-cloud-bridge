import { describe, it, expect } from 'vitest';
import { isAuthorized } from '../src/auth';

describe('isAuthorized', () => {
  it('accepts an exact match', () => {
    expect(isAuthorized('secret', 'secret')).toBe(true);
  });
  it('rejects a different token of the same length', () => {
    expect(isAuthorized('secreT', 'secret')).toBe(false);
  });
  it('rejects a different length', () => {
    expect(isAuthorized('sec', 'secret')).toBe(false);
  });
  it('rejects an empty token', () => {
    expect(isAuthorized('', 'secret')).toBe(false);
  });
});
