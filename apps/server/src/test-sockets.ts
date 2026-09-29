import { randomBytes } from 'node:crypto';
import { connect, type Socket } from 'node:net';

/**
 * Test helpers that talk raw TCP to the WebSocket endpoints, to send what no well-behaved client
 * would: broken frames or a reset in the middle of the handshake.
 */

function upgradeRequest(path: string, headers: Record<string, string>) {
  const lines = [
    `GET ${path} HTTP/1.1`,
    'Host: 127.0.0.1',
    'Connection: Upgrade',
    'Upgrade: websocket',
    'Sec-WebSocket-Version: 13',
    `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
  ];
  return `${lines.join('\r\n')}\r\n\r\n`;
}

/** Opens a WebSocket by hand and resolves once the server switched protocols. */
export function rawUpgrade(port: number, path: string, headers: Record<string, string>) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(upgradeRequest(path, headers));
    });
    socket.once('data', (data: Buffer) => {
      if (data.toString().startsWith('HTTP/1.1 101')) resolve(socket);
      else reject(new Error(`Upgrade refused: ${data.toString().split('\r\n')[0] ?? ''}`));
    });
    socket.once('error', reject);
  });
}

/** Resolves when the server closes the connection. */
export function closedByServer(socket: Socket) {
  return new Promise<void>((resolve) => {
    socket.once('close', () => {
      resolve();
    });
    socket.on('error', () => undefined);
  });
}

/**
 * Sends an upgrade request and resets the TCP connection `afterMs` later, e.g. while the server
 * still checks access.
 */
export function resetDuringUpgrade(
  port: number,
  path: string,
  headers: Record<string, string>,
  afterMs: number,
) {
  return new Promise<void>((resolve) => {
    const socket = connect(port, '127.0.0.1', () => {
      socket.write(upgradeRequest(path, headers), () => {
        setTimeout(() => {
          socket.resetAndDestroy();
          resolve();
        }, afterMs);
      });
    });
    socket.on('error', () => undefined);
  });
}

/** An unmasked text frame "hi": clients must mask their frames, so the server has to refuse it. */
export const UNMASKED_FRAME = Buffer.from([0x81, 0x02, 0x68, 0x69]);
