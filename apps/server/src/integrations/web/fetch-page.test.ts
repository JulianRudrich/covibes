import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  fetchPage,
  isPublicAddress,
  PageFetchError,
  type PageFetchOptions,
} from '@server/integrations/web/fetch-page';

describe('isPublicAddress', () => {
  it('accepts addresses of the public internet', () => {
    for (const address of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111']) {
      expect(isPublicAddress(address), address).toBe(true);
    }
  });

  it('refuses this machine, private networks and other non-public ranges', () => {
    for (const address of [
      '127.0.0.1',
      '127.8.9.10',
      '0.0.0.0',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254', // metadata services
      '100.64.0.1',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:10.0.0.1',
      '64:ff9b::7f00:1',
      '::7f00:1', // IPv4-compatible
      '2001::1', // Teredo
      '2002:7f00:1::',
    ]) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });

  it('refuses whatever is no IP address', () => {
    for (const address of ['', 'localhost', 'example.org', '1.2.3', '999.1.1.1']) {
      expect(isPublicAddress(address), address).toBe(false);
    }
  });
});

describe('fetchPage', () => {
  let server: Server;
  let port: number;
  /** Options that let the fetch reach the local test server. */
  let local: PageFetchOptions;
  const at = (path: string) => `http://127.0.0.1:${String(port)}${path}`;

  const pages: Record<string, (request: IncomingMessage, response: ServerResponse) => void> = {
    '/page': (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=ISO-8859-1' });
      response.end('<h1>Hallo</h1>');
    },
    '/headers': (request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(request.headers));
    },
    '/moved': (_request, response) => {
      response.writeHead(302, { location: '/page' });
      response.end();
    },
    '/loop': (_request, response) => {
      response.writeHead(301, { location: '/loop' });
      response.end();
    },
    '/to-internal': (_request, response) => {
      response.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      response.end();
    },
    '/to-file': (_request, response) => {
      response.writeHead(302, { location: 'file:///etc/passwd' });
      response.end();
    },
    '/to-port': (_request, response) => {
      response.writeHead(302, { location: 'http://127.0.0.1:5432/' });
      response.end();
    },
    '/image': (_request, response) => {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    },
    '/untyped': (_request, response) => {
      response.writeHead(200);
      response.end('?');
    },
    '/long': (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('x'.repeat(5000));
    },
    '/pdf': (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/pdf' });
      response.end(Buffer.alloc(5000, 1));
    },
    '/packed': (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
      response.end(Buffer.from([0x1f, 0x8b, 0x08]));
    },
    '/missing': (_request, response) => {
      response.writeHead(404, { 'content-type': 'text/html' });
      response.end('Not here');
    },
    '/slow': () => {
      // Never answers.
    },
    '/stalls': (_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.write('Anfang');
    },
  };

  beforeAll(async () => {
    server = createServer((request, response) => {
      const handler = pages[(request.url ?? '').split('?')[0] ?? ''];
      if (handler) handler(request, response);
      else {
        response.writeHead(500);
        response.end();
      }
    });
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    ({ port } = server.address() as AddressInfo);
    local = { isAllowedAddress: () => true, extraPorts: [port] };
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const problemOf = async (url: string, options: PageFetchOptions = local) => {
    try {
      await fetchPage(url, options);
      return 'fetched';
    } catch (error) {
      if (!(error instanceof PageFetchError)) throw error;
      return error.detail ? `${error.problem}: ${error.detail}` : error.problem;
    }
  };

  it('fetches a page with its type and charset', async () => {
    const page = await fetchPage(at('/page'), local);

    expect(page).toMatchObject({
      url: at('/page'),
      mediaType: 'text/html',
      charset: 'ISO-8859-1',
      truncated: false,
    });
    expect(page.body.toString()).toBe('<h1>Hallo</h1>');
  });

  it('asks for plain bytes and sends nothing of the person or the server', async () => {
    const page = await fetchPage(at('/headers'), local);
    const headers = JSON.parse(page.body.toString()) as Record<string, string>;

    expect(headers['accept-encoding']).toBe('identity');
    expect(headers['user-agent']).toBe('Covibes link reader');
    expect(headers).not.toHaveProperty('cookie');
    expect(headers).not.toHaveProperty('authorization');
    expect(headers).not.toHaveProperty('referer');
  });

  it('follows redirects and reports where it ended', async () => {
    expect((await fetchPage(at('/moved'), local)).url).toBe(at('/page'));
  });

  it('gives up on redirects without end', async () => {
    expect(await problemOf(at('/loop'))).toBe('too_many_redirects');
    expect(await problemOf(at('/moved'), { ...local, maxRedirects: 0 })).toBe('too_many_redirects');
  });

  it('checks every redirect like the first address', async () => {
    // Only the test server's address is allowed here, as the public web is in production.
    const guarded = { ...local, isAllowedAddress: (address: string) => address === '127.0.0.1' };

    expect(await problemOf(at('/to-internal'), guarded)).toBe('blocked: address');
    expect(await problemOf(at('/to-file'), guarded)).toBe('invalid_url: only http and https');
    expect(await problemOf(at('/to-port'), guarded)).toBe('blocked: port');
  });

  it('refuses this machine and private networks, by address and by name', async () => {
    const standardPort = { extraPorts: [port] };

    expect(await problemOf(at('/page'), standardPort)).toBe('blocked: address');
    expect(await problemOf(`http://localhost:${String(port)}/page`, standardPort)).toBe(
      'blocked: address',
    );
    expect(await problemOf(`http://[::1]:${String(port)}/page`, standardPort)).toBe(
      'blocked: address',
    );
    for (const url of [
      'http://127.0.0.1/',
      'http://2130706433/', // 127.0.0.1 as one number
      'http://0x7f.1/',
      'http://10.0.0.5/',
      'http://192.168.0.1/admin',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fd00::1]/',
    ]) {
      expect(await problemOf(url, {}), url).toBe('blocked: address');
    }
  });

  it('refuses other ports, other schemes and addresses with credentials', async () => {
    expect(await problemOf(at('/page'), {})).toBe('blocked: port');
    expect(await problemOf('https://example.org:8443/', {})).toBe('blocked: port');
    expect(await problemOf('ftp://example.org/', {})).toBe('invalid_url: only http and https');
    expect(await problemOf('file:///etc/passwd', {})).toBe('invalid_url: only http and https');
    expect(await problemOf('javascript:alert(1)', {})).toBe('invalid_url: only http and https');
    expect(await problemOf('https://user:secret@example.org/', {})).toBe('invalid_url');
    expect(await problemOf('not an address', {})).toBe('invalid_url');
  });

  it('reads only text formats and PDFs', async () => {
    expect(await problemOf(at('/image'))).toBe('unsupported: image/png');
    expect(await problemOf(at('/untyped'))).toBe('unsupported: unknown type');
    // A body that is packed although plain bytes were asked for is not unpacked.
    expect(await problemOf(at('/packed'))).toBe('unsupported: compressed with gzip');
    expect(await problemOf(at('/missing'))).toBe('status: 404');
  });

  it('cuts long text off and refuses a PDF that is too large', async () => {
    const page = await fetchPage(at('/long'), { ...local, maxTextBytes: 1000 });
    expect(page.truncated).toBe(true);
    expect(page.body.byteLength).toBe(1000);

    expect(await problemOf(at('/pdf'), { ...local, maxPdfBytes: 1000 })).toBe('too_large');
    expect((await fetchPage(at('/pdf'), local)).body.byteLength).toBe(5000);
  });

  it('stops waiting after the time limit, also in the middle of a page', async () => {
    expect(await problemOf(at('/slow'), { ...local, timeoutMs: 100 })).toBe('timeout');
    expect(await problemOf(at('/stalls'), { ...local, timeoutMs: 100 })).toBe('timeout');
  });

  it('says so when nothing answers', async () => {
    const closed = createServer();
    await new Promise<void>((resolve) => {
      closed.listen(0, '127.0.0.1', resolve);
    });
    const { port: free } = closed.address() as AddressInfo;
    await new Promise((resolve) => closed.close(resolve));

    expect(
      await problemOf(`http://127.0.0.1:${String(free)}/`, {
        isAllowedAddress: () => true,
        extraPorts: [free],
      }),
    ).toBe('unreachable: ECONNREFUSED');
  });
});
