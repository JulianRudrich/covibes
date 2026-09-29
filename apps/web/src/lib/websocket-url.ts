/** WebSocket address of a path on the web app's own origin: `ws:` locally, `wss:` behind HTTPS. */
export function sameOriginWebSocketUrl(
  location: Pick<Location, 'protocol' | 'host'>,
  path: string,
): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${location.host}${path}`;
}
