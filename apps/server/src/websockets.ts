import type { IncomingHttpHeaders, IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';

import type { WebSocket, WebSocketServer } from 'ws';

/** Takes over one WebSocket upgrade; `url` is the parsed request URL. */
export type UpgradeHandler = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  url: URL,
) => void;

const STATUS_TEXT = {
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
} as const;

/** Answers an upgrade request with a plain HTTP error and closes the socket. */
export function rejectUpgrade(socket: Duplex, status: keyof typeof STATUS_TEXT) {
  socket.end(`HTTP/1.1 ${String(status)} ${STATUS_TEXT[status]}\r\nConnection: close\r\n\r\n`);
}

/** The handshake headers as a Fetch `Headers` object, e.g. for the session check. */
export function fetchHeaders(incoming: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

// Between the `upgrade` event and the WebSocket handshake nobody listens for socket errors, and an
// unhandled `error` event ends the process. A connection reset during the (async) access check
// would do exactly that, so the router guards the socket until the handshake takes over.
function destroyOnError(this: Duplex) {
  this.destroy();
}

/**
 * Completes the WebSocket handshake after the access check. Every accepted socket gets an error
 * listener: oversized or malformed frames make `ws` emit `error`, which would otherwise crash the
 * server; `ws` closes such a connection by itself.
 */
export function acceptUpgrade(
  webSockets: WebSocketServer,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  onOpen: (webSocket: WebSocket) => void,
) {
  socket.removeListener('error', destroyOnError);
  webSockets.handleUpgrade(request, socket, head, (webSocket) => {
    webSocket.on('error', (error) => {
      console.warn(`WebSocket closed after an invalid frame: ${error.message}`);
    });
    onOpen(webSocket);
  });
}

/**
 * Routes WebSocket upgrades by path (collaboration, live channel) on the API's HTTP server.
 * Browsers attach the session cookie to WebSocket requests from other sites too, so only the web
 * app's own origin may connect (protection against cross-site WebSocket hijacking).
 * `stop()` refuses new connections while the server shuts down.
 */
export function attachWebSockets(
  server: Server,
  options: { appUrl: string; routes: ReadonlyMap<string, UpgradeHandler> },
) {
  const allowedOrigin = new URL(options.appUrl).origin;
  let stopped = false;

  server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    socket.on('error', destroyOnError);
    const url = new URL(request.url ?? '/', 'http://localhost');
    const handler = options.routes.get(url.pathname);
    if (!handler) {
      socket.destroy();
      return;
    }
    if (stopped) {
      rejectUpgrade(socket, 503);
      return;
    }
    if (request.headers.origin !== allowedOrigin) {
      rejectUpgrade(socket, 403);
      return;
    }
    handler(request, socket, head, url);
  });

  return {
    stop() {
      stopped = true;
    },
  };
}
