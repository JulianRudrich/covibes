import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';

// Fetching a page for an agent (spec 20b). An agent may be told any address, by a person, by a
// page or by a search result, so the fetch only reaches the public web: never this machine, a
// private network or another non-public range, whatever a name resolves to and wherever a
// redirect leads.

/** Addresses that are not the public web. */
const NON_PUBLIC = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, broadcast
] as const) {
  NON_PUBLIC.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
  // Not `::/8` as a whole: the list checks IPv4 addresses as `::ffff:a.b.c.d` against these too.
  ['::', 96], // unspecified, loopback, IPv4-compatible
  ['64:ff9b::', 96], // NAT64, reaches IPv4
  ['64:ff9b:1::', 48], // local NAT64
  ['100::', 64], // discard
  ['2001::', 23], // protocol assignments, Teredo
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4, reaches IPv4
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
] as const) {
  NON_PUBLIC.addSubnet(address, prefix, 'ipv6');
}

const MAPPED_IPV4 = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

/** Whether an IP address belongs to the public internet. Anything that is no IP is not. */
export function isPublicAddress(address: string): boolean {
  const mapped = MAPPED_IPV4.exec(address);
  if (mapped?.[1]) return isPublicAddress(mapped[1]);
  const family = isIP(address);
  if (family === 4) return !NON_PUBLIC.check(address, 'ipv4');
  if (family === 6) {
    // Any other IPv4-mapped form (e.g. written in hex) reaches IPv4 too.
    if (/^(0*:)*0*:?ffff:/i.test(address)) return false;
    return !NON_PUBLIC.check(address, 'ipv6');
  }
  return false;
}

export type PageFetchProblem =
  | 'invalid_url'
  | 'blocked'
  | 'unreachable'
  | 'timeout'
  | 'status'
  | 'too_many_redirects'
  | 'unsupported'
  | 'too_large';

/** Why a page could not be fetched; `detail` is e.g. the HTTP status. */
export class PageFetchError extends Error {
  override name = 'PageFetchError';
  constructor(
    readonly problem: PageFetchProblem,
    readonly detail = '',
  ) {
    super(`Could not fetch the page: ${problem}${detail ? ` (${detail})` : ''}`);
  }
}

export type PageFetchOptions = {
  /** Which resolved addresses may be reached; tests allow their local server. */
  isAllowedAddress?: (address: string) => boolean;
  /** Ports besides the standard ones; tests allow their local server's port. */
  extraPorts?: readonly number[];
  timeoutMs?: number;
  /** Longest text body; more is cut off. */
  maxTextBytes?: number;
  /** Largest PDF; more is refused, since a cut PDF cannot be read. */
  maxPdfBytes?: number;
  maxRedirects?: number;
};

export type FetchedPage = {
  /** The address after redirects. */
  url: string;
  /** The media type without parameters, lowercase. */
  mediaType: string;
  /** The charset the server named, if any. */
  charset: string | undefined;
  body: Buffer;
  /** True when the body was longer than allowed and cut off. */
  truncated: boolean;
};

const DEFAULTS = {
  timeoutMs: 10_000,
  maxTextBytes: 2 * 1024 * 1024,
  maxPdfBytes: 10 * 1024 * 1024,
  maxRedirects: 5,
};

const STANDARD_PORTS: Readonly<Record<string, number>> = { 'http:': 80, 'https:': 443 };

/** Media types an agent can read: text in any form, JSON, XML and PDF. */
function isReadable(mediaType: string): boolean {
  return (
    mediaType.startsWith('text/') ||
    mediaType === 'application/json' ||
    mediaType === 'application/xml' ||
    mediaType === 'application/xhtml+xml' ||
    mediaType === 'application/pdf' ||
    mediaType.endsWith('+json') ||
    mediaType.endsWith('+xml')
  );
}

function parseTarget(rawUrl: string, options: PageFetchOptions): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PageFetchError('invalid_url');
  }
  const standard = STANDARD_PORTS[url.protocol];
  if (standard === undefined) throw new PageFetchError('invalid_url', 'only http and https');
  // Credentials in an address are a way to disguise where it leads.
  if (url.username !== '' || url.password !== '') throw new PageFetchError('invalid_url');
  const port = url.port === '' ? standard : Number(url.port);
  if (port !== standard && !(options.extraPorts ?? []).includes(port)) {
    throw new PageFetchError('blocked', 'port');
  }
  // An IP written into the address never goes through the lookup, so it is checked here.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) !== 0 && !(options.isAllowedAddress ?? isPublicAddress)(host)) {
    throw new PageFetchError('blocked', 'address');
  }
  return url;
}

/**
 * The lookup of the connection itself: it resolves the name and refuses it if any of its addresses
 * is not allowed. Checking at connection time (and not only before) closes the gap in which a name
 * could resolve differently the second time.
 */
function guardedLookup(isAllowed: (address: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
      const list: LookupAddress[] = Array.isArray(addresses) ? addresses : [];
      const [first] = list;
      if (error || !first) {
        callback(error ?? new Error(`No address for ${hostname}`), '', 0);
        return;
      }
      if (list.some((entry) => !isAllowed(entry.address))) {
        callback(Object.assign(new Error('Address not allowed'), { code: 'EBLOCKED' }), '', 0);
        return;
      }
      if (options.all) callback(null, list);
      else callback(null, first.address, first.family);
    });
  };
}

function requestOnce(
  url: URL,
  options: PageFetchOptions,
  signal: AbortSignal,
): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = send(
      url,
      {
        method: 'GET',
        signal,
        // Its own connection: a pooled one could have been opened without the guarded lookup.
        agent: false,
        lookup: guardedLookup(options.isAllowedAddress ?? isPublicAddress),
        headers: {
          'user-agent': 'Covibes link reader',
          accept:
            'text/html,application/xhtml+xml,text/plain,application/json,application/pdf;q=0.9,*/*;q=0.1',
          // Plain bytes: nothing to unpack, and the size limit counts what is read.
          'accept-encoding': 'identity',
        },
      },
      resolve,
    );
    request.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'EBLOCKED'
          ? new PageFetchError('blocked', 'address')
          : signal.aborted
            ? new PageFetchError('timeout')
            : new PageFetchError('unreachable', error.code ?? ''),
      );
    });
    request.end();
  });
}

/** Reads the body up to `limit` bytes; says whether there was more. */
async function readBody(
  response: IncomingMessage,
  limit: number,
): Promise<{ body: Buffer; exceeded: boolean }> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response as AsyncIterable<Buffer>) {
    if (size + chunk.byteLength > limit) {
      chunks.push(chunk.subarray(0, limit - size));
      response.destroy();
      return { body: Buffer.concat(chunks), exceeded: true };
    }
    chunks.push(chunk);
    size += chunk.byteLength;
  }
  return { body: Buffer.concat(chunks), exceeded: false };
}

/**
 * Fetches a public web page: follows redirects (each checked like the first address), within a
 * time limit, and returns the body of a readable media type, cut off at the size limit.
 */
export async function fetchPage(
  rawUrl: string,
  options: PageFetchOptions = {},
): Promise<FetchedPage> {
  const limits = { ...DEFAULTS, ...options };
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, limits.timeoutMs);
  try {
    let url = parseTarget(rawUrl, options);
    for (let hop = 0; ; hop += 1) {
      const response = await requestOnce(url, options, controller.signal);
      const status = response.statusCode ?? 0;
      const { location } = response.headers;
      if (status >= 300 && status < 400 && location) {
        response.destroy();
        if (hop >= limits.maxRedirects) throw new PageFetchError('too_many_redirects');
        url = parseTarget(new URL(location, url).href, options);
        continue;
      }
      if (status < 200 || status >= 300) {
        response.destroy();
        throw new PageFetchError('status', String(status));
      }

      const [type = '', ...parameters] = (response.headers['content-type'] ?? '').split(';');
      const mediaType = type.trim().toLowerCase();
      if (!isReadable(mediaType)) {
        response.destroy();
        throw new PageFetchError('unsupported', mediaType || 'unknown type');
      }
      // Plain bytes were asked for; a body that is packed anyway is not unpacked, since the size
      // limit would then count the wrong bytes.
      const encoding = (response.headers['content-encoding'] ?? 'identity').trim().toLowerCase();
      if (encoding !== '' && encoding !== 'identity') {
        response.destroy();
        throw new PageFetchError('unsupported', `compressed with ${encoding}`);
      }
      const charset = parameters
        .map((parameter) => /^\s*charset\s*=\s*"?([^";]+)"?\s*$/i.exec(parameter)?.[1])
        .find((value) => value !== undefined);
      const isPdf = mediaType === 'application/pdf';
      const { body, exceeded } = await readBody(
        response,
        isPdf ? limits.maxPdfBytes : limits.maxTextBytes,
      );
      if (exceeded && isPdf) throw new PageFetchError('too_large');
      return { url: url.href, mediaType, charset, body, truncated: exceeded };
    }
  } catch (error) {
    if (error instanceof PageFetchError) throw error;
    throw controller.signal.aborted
      ? new PageFetchError('timeout')
      : new PageFetchError('unreachable');
  } finally {
    clearTimeout(timer);
  }
}
