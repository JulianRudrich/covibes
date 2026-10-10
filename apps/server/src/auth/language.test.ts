import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { requestLanguage } from '@server/auth/auth';
import { APP_URL, createTestServer } from '@server/testing';

// The language of an account (spec 32a): a new one starts in the language of its browser, its
// owner changes it, and the login mail is written in the language of the page that asked.
const test = createTestServer();

const GERMAN_SUBJECT = 'Dein Login-Link für Covibes';
const ENGLISH_SUBJECT = 'Your Covibes login link';

/** Asks for a login link like the login page does, and gives the mail that was sent. */
async function askForLink(
  email: string,
  options: { page?: string; browser?: string; metadata?: Record<string, unknown> } = {},
) {
  const headers = new Headers({ 'content-type': 'application/json', origin: APP_URL });
  if (options.browser) headers.set('accept-language', options.browser);
  const metadata = options.metadata ?? (options.page ? { language: options.page } : undefined);
  const response = await test.app.request('/api/auth/sign-in/magic-link', {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, callbackURL: '/', ...(metadata ? { metadata } : {}) }),
  });
  expect(response.status).toBe(200);
  // The outbox lists the newest mail first.
  const mail = test.outbox?.list().find((candidate) => candidate.to === email);
  if (!mail) throw new Error(`No login mail was sent to ${email}`);
  return mail;
}

/** Signs in with a new address from a browser that prefers `browser`; gives the session cookie. */
async function signInFrom(browser: string | undefined, email = `${randomUUID()}@example.com`) {
  const mail = await askForLink(email);
  const link = /https?:\/\/\S+/.exec(mail.text)?.[0];
  if (!link) throw new Error('The mail has no link');
  const verified = await test.app.request(link, {
    headers: browser ? { 'accept-language': browser } : {},
  });
  expect(verified.status).toBe(302);
  const cookie = verified.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  return { cookie, email };
}

async function localeOf(cookie: string) {
  const response = await test.app.request('/api/auth/get-session', { headers: { cookie } });
  const session = (await response.json()) as { user: { locale?: unknown } } | null;
  return session?.user.locale;
}

function setLocale(cookie: string, locale: unknown) {
  return test.app.request('/api/auth/update-user', {
    method: 'POST',
    headers: { cookie, origin: APP_URL, 'content-type': 'application/json' },
    body: JSON.stringify({ locale }),
  });
}

describe('requestLanguage', () => {
  it('is the language the browser prefers, English for someone who prefers neither', () => {
    expect(requestLanguage(new Headers({ 'accept-language': 'de-CH,de;q=0.9,en;q=0.8' }))).toBe(
      'de',
    );
    expect(requestLanguage(new Headers({ 'accept-language': 'en-US,en;q=0.9' }))).toBe('en');
    expect(requestLanguage(new Headers({ 'accept-language': 'fr-FR,fr;q=0.9' }))).toBe('en');
  });

  it('is unknown for a request that names no language', () => {
    expect(requestLanguage(new Headers())).toBeUndefined();
    expect(requestLanguage(new Headers({ 'accept-language': '*' }))).toBeUndefined();
    expect(requestLanguage(undefined)).toBeUndefined();
  });
});

describe('the mail with the login link', () => {
  it('is written in the language of the page that asked for it', async () => {
    const english = await askForLink(`${randomUUID()}@example.com`, { page: 'en' });
    const german = await askForLink(`${randomUUID()}@example.com`, { page: 'de' });

    expect(english.subject).toBe(ENGLISH_SUBJECT);
    expect(english.text).toContain('use this link to sign in to Covibes');
    expect(german.subject).toBe(GERMAN_SUBJECT);
  });

  it('follows the page, not the browser', async () => {
    const mail = await askForLink(`${randomUUID()}@example.com`, {
      page: 'de',
      browser: 'en-US,en;q=0.9',
    });

    expect(mail.subject).toBe(GERMAN_SUBJECT);
  });

  it('falls back to the browser, and to German for a request that names no language', async () => {
    const browser = await askForLink(`${randomUUID()}@example.com`, { browser: 'en-GB,en;q=0.9' });
    const nothing = await askForLink(`${randomUUID()}@example.com`);
    // A page that names something else than a language is not believed.
    const odd = await askForLink(`${randomUUID()}@example.com`, {
      metadata: { language: 'fr' },
      browser: 'de',
    });
    const worse = await askForLink(`${randomUUID()}@example.com`, {
      metadata: { language: { toString: 'en' } },
    });

    expect(browser.subject).toBe(ENGLISH_SUBJECT);
    expect(nothing.subject).toBe(GERMAN_SUBJECT);
    expect(odd.subject).toBe(GERMAN_SUBJECT);
    expect(worse.subject).toBe(GERMAN_SUBJECT);
  });
});

describe('the language of an account', () => {
  it('starts as the language of the browser that opens the first login link', async () => {
    expect(await localeOf((await signInFrom('en-US,en;q=0.9,de;q=0.5')).cookie)).toBe('en');
    expect(await localeOf((await signInFrom('de-AT,de;q=0.9,en;q=0.8')).cookie)).toBe('de');
    // Someone who prefers neither reads English.
    expect(await localeOf((await signInFrom('pt-BR,pt;q=0.9')).cookie)).toBe('en');
    // A request that names no language keeps the default.
    expect(await localeOf((await signInFrom(undefined)).cookie)).toBe('de');
  });

  it('stays what it is when the account signs in from another browser', async () => {
    const first = await signInFrom('de');

    const again = await signInFrom('en-US', first.email);

    expect(await localeOf(again.cookie)).toBe('de');
  });

  it('is changed by its owner, and for nobody else', async () => {
    const olga = await signInFrom('de');
    const emil = await signInFrom('de');

    const changed = await setLocale(olga.cookie, 'en');

    expect(changed.status).toBe(200);
    expect(await localeOf(olga.cookie)).toBe('en');
    expect(await localeOf(emil.cookie)).toBe('de');
    const stored = await test.db.adminPool.query<{ locale: string }>(
      'select locale from users where email = $1',
      [olga.email],
    );
    expect(stored.rows[0]?.locale).toBe('en');
  });

  it('takes the two languages and nothing else', async () => {
    const olga = await signInFrom('de');

    for (const locale of ['fr', 'EN', '', 7, null, { language: 'en' }]) {
      const response = await setLocale(olga.cookie, locale);
      expect(response.status, JSON.stringify(locale)).toBeGreaterThanOrEqual(400);
      expect(response.status, JSON.stringify(locale)).toBeLessThan(500);
    }
    expect(await localeOf(olga.cookie)).toBe('de');
  });

  it('is not changed without a session', async () => {
    const response = await test.app.request('/api/auth/update-user', {
      method: 'POST',
      headers: { origin: APP_URL, 'content-type': 'application/json' },
      body: JSON.stringify({ locale: 'en' }),
    });

    expect(response.status).toBe(401);
  });
});
