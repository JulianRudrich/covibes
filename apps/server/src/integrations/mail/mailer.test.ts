import type { Transporter } from 'nodemailer';
import { describe, expect, it } from 'vitest';

import { createMailSetup, DevOutbox, SmtpMailer } from '@server/integrations/mail/mailer';

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
