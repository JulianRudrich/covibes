function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 0x20) return true;
  }
  return false;
}

/**
 * Returns `value` if it is a path inside this app, otherwise undefined.
 * Guards the `redirect`/`next` parameters against open redirects to other sites.
 */
export function safeRedirectPath(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return undefined;
  }
  if (value.includes('\\') || hasControlCharacter(value)) return undefined;

  const base = 'https://covibes.invalid';
  const url = new URL(value, base);
  return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : undefined;
}
