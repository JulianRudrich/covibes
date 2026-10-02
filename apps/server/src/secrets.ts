import { createHash, timingSafeEqual } from 'node:crypto';

/** Constant-time comparison of two secrets; hashing first gives both sides the same length. */
export function sameSecret(given: string, expected: string): boolean {
  const hash = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(hash(given), hash(expected));
}
