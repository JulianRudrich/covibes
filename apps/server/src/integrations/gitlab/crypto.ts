import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { GIT_ORIGINS, type GitOrigin } from '@covibes/shared';
import { z } from 'zod';

// What the server keeps secret around a GitLab connection (spec 28a): the tokens as they are
// stored, and the `state` that ties the way back from GitLab to the person who started it. Both
// rest on `TOKEN_KEY`; each purpose gets a key of its own from it.

const VERSION = 'v1';

function keyFor(tokenKey: string, purpose: 'tokens' | 'state'): Buffer {
  return createHash('sha256').update(`covibes:${purpose}:${tokenKey}`).digest();
}

/**
 * A token as it is stored: encrypted with AES-256-GCM, with a fresh nonce every time, so the same
 * token never looks the same twice. The form is `v1.nonce.ciphertext.tag`.
 */
export function sealToken(tokenKey: string, token: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(tokenKey, 'tokens'), nonce);
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [VERSION, nonce, ciphertext, cipher.getAuthTag()]
    .map((part) => (typeof part === 'string' ? part : part.toString('base64url')))
    .join('.');
}

/** The token of a stored form; throws if it was changed or sealed with another key. */
export function openToken(tokenKey: string, sealed: string): string {
  const [version, nonce, ciphertext, tag] = sealed.split('.');
  if (version !== VERSION || !nonce || ciphertext === undefined || !tag) {
    throw new Error('The stored token has an unknown form');
  }
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFor(tokenKey, 'tokens'),
    Buffer.from(nonce, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** How long the way to GitLab and back may take. */
export const STATE_LIFETIME_MS = 10 * 60_000;

const statePayloadSchema = z.object({
  userId: z.uuid(),
  projectId: z.uuid().nullable(),
  origin: z.enum(GIT_ORIGINS),
  expiresAt: z.number(),
  nonce: z.string().min(1),
});

/**
 * What a flow to GitLab was started for: the person, the project they were in (to come back to
 * it), and the dialog they started it from.
 */
export type FlowState = { userId: string; projectId: string | null; origin: GitOrigin };

function signature(tokenKey: string, payload: string): Buffer {
  return createHmac('sha256', keyFor(tokenKey, 'state')).update(payload).digest();
}

/**
 * The `state` of an OAuth flow: which person it was started for and from where, and until when
 * it holds, signed by the server. GitLab hands it back unchanged.
 */
export function signState(
  tokenKey: string,
  { userId, projectId, origin }: FlowState,
  now = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      projectId,
      origin,
      expiresAt: now + STATE_LIFETIME_MS,
      nonce: randomBytes(9).toString('base64url'),
    }),
  ).toString('base64url');
  return `${payload}.${signature(tokenKey, payload).toString('base64url')}`;
}

/** What a `state` was signed for; undefined if it is forged, damaged or expired. */
export function readState(
  tokenKey: string,
  state: string,
  now = Date.now(),
): FlowState | undefined {
  const [payload, signed, ...rest] = state.split('.');
  if (!payload || !signed || rest.length > 0) return undefined;
  const given = Buffer.from(signed, 'base64url');
  const expected = signature(tokenKey, payload);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  const parsed = statePayloadSchema.safeParse(json);
  if (!parsed.success || parsed.data.expiresAt <= now) return undefined;
  return {
    userId: parsed.data.userId,
    projectId: parsed.data.projectId,
    origin: parsed.data.origin,
  };
}
