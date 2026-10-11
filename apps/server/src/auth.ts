import { timingSafeEqual } from 'node:crypto';

/**
 * Compare a presented token with the expected one in constant time,
 * so an attacker cannot learn the token one character at a time from response timing.
 */
export function isAuthorized(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
