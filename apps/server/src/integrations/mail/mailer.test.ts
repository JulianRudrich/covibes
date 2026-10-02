import type { Transporter } from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';

import {
  createMailSetup,
  createWorkerMailer,
  DevOutbox,
  ServerMailboxMailer,
  SmtpMailer,
} from '@server/integrations/mail/mailer';

const SMTP = {
  SMTP_URL: 'smtps://user:secret@mail.example.com:465',
  MAIL_FROM: 'Covibes <a@b.de>',
};

describe('createMailSetup', () => {
  it('uses the development mailbox locally and in tests', () => {
    for (const NODE_ENV of ['development', 'test'] as const) {
      const setup = createMailSetup({ NODE_ENV, ...SMTP });
      expect(setup.outbox).toBeInstanceOf(DevOutbox);
      expect(setup.mailer).toBe(setup.outbox);
    }
  });

  it('sends over SMTP in production, or not at all without SMTP', () => {
    const withSmtp = createMailSetup({ NODE_ENV: 'production', ...SMTP });
    expect(withSmtp.mailer).toBeInstanceOf(SmtpMailer);
    expect(withSmtp.outbox).toBeUndefined();
    expect(createMailSetup({ NODE_ENV: 'production' })).toEqual({
      mailer: undefined,
      outbox: undefined,
    });
  });
});

describe('SmtpMailer', () => {
  it('sends plain text mails from the configured sender', async () => {
    const sent: unknown[] = [];
    const transport = {
      sendMail: (message: unknown) => {
        sent.push(message);
        return Promise.resolve({});
      },
    } as unknown as Transporter;

    await new SmtpMailer(transport, SMTP.MAIL_FROM).send({
      to: 'olga@example.com',
      subject: 'Dein Login-Link',
      text: 'Hallo',
    });

    expect(sent).toEqual([
      { from: SMTP.MAIL_FROM, to: 'olga@example.com', subject: 'Dein Login-Link', text: 'Hallo' },
    ]);
  });
});

describe('the mailer of the worker (spec 22b)', () => {
  const env = {
    COLLAB_URL: 'ws://127.0.0.1:3001/api/collab',
    INTERNAL_TOKEN: 'internal-token-for-the-tests-0123456789',
  };

  it('is SMTP in production, the mailbox of the server locally, and nothing in tests', () => {
    expect(createWorkerMailer({ ...env, NODE_ENV: 'production', ...SMTP })).toBeInstanceOf(
      SmtpMailer,
    );
    // Without SMTP nothing is mailed.
    expect(createWorkerMailer({ ...env, NODE_ENV: 'production' })).toBeUndefined();
    expect(createWorkerMailer({ ...env, NODE_ENV: 'development', ...SMTP })).toBeInstanceOf(
      ServerMailboxMailer,
    );
    expect(createWorkerMailer({ ...env, NODE_ENV: 'test' })).toBeUndefined();
  });

  it('hands its mails to the development mailbox of the server it draws through', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    const mail = { to: 'olga@example.com', subject: 'Neues', text: 'Hallo' };

    try {
      await createWorkerMailer({ ...env, NODE_ENV: 'development' })?.send(mail);
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:3001/api/dev/mails', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-token': env.INTERNAL_TOKEN },
        body: JSON.stringify(mail),
      });

      // A mail the server refuses fails the job, so it is tried again.
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
      await expect(
        new ServerMailboxMailer('http://127.0.0.1:3001/api/dev/mails', 'wrong').send(mail),
      ).rejects.toThrow('refused the mail (403)');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
