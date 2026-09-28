import nodemailer, { type Transporter } from 'nodemailer';

import type { ServerEnv } from '@server/env';

export type Mail = {
  to: string;
  subject: string;
  text: string;
};

export type Mailer = {
  send: (mail: Mail) => Promise<void>;
};

export type StoredMail = Mail & { id: number; sentAt: string };

/**
 * Development mailbox: keeps the latest mails in memory instead of sending them. The web app shows
 * them under /dev/mails.
 */
export class DevOutbox implements Mailer {
  private readonly mails: StoredMail[] = [];
  private nextId = 1;

  constructor(private readonly limit = 50) {}

  send(mail: Mail): Promise<void> {
    this.mails.unshift({ ...mail, id: this.nextId++, sentAt: new Date().toISOString() });
    this.mails.length = Math.min(this.mails.length, this.limit);
    return Promise.resolve();
  }

  /** Newest first. */
  list(): StoredMail[] {
    return [...this.mails];
  }
}

/** Real delivery over SMTP (spec 02b). */
export class SmtpMailer implements Mailer {
  constructor(
    private readonly transport: Transporter,
    private readonly from: string,
  ) {}

  async send(mail: Mail): Promise<void> {
    await this.transport.sendMail({
      from: this.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
    });
  }
}

export type MailSetup = {
  /** Sends the mails; missing in production without SMTP, which switches off the login by mail. */
  mailer: Mailer | undefined;
  /** The development mailbox, only locally and in tests. */
  outbox: DevOutbox | undefined;
};

export function createMailSetup(
  env: Pick<ServerEnv, 'NODE_ENV' | 'SMTP_URL' | 'MAIL_FROM'>,
): MailSetup {
  if (env.NODE_ENV !== 'production') {
    const outbox = new DevOutbox();
    return { mailer: outbox, outbox };
  }
  if (env.SMTP_URL && env.MAIL_FROM) {
    return {
      mailer: new SmtpMailer(nodemailer.createTransport(env.SMTP_URL), env.MAIL_FROM),
      outbox: undefined,
    };
  }
  return { mailer: undefined, outbox: undefined };
}
