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

/**
 * Hands a mail of the worker to the server's development mailbox (spec 22b): the mailbox lives in
 * the server's memory, and the worker is another process. Only locally; the server checks the
 * shared secret.
 */
export class ServerMailboxMailer implements Mailer {
  constructor(
    private readonly endpoint: string,
    private readonly token: string,
  ) {}

  async send(mail: Mail): Promise<void> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [INTERNAL_TOKEN_HEADER]: this.token },
      body: JSON.stringify(mail),
    });
    if (!response.ok) {
      throw new Error(`The development mailbox refused the mail (${String(response.status)})`);
    }
  }
}

/** The header the worker proves itself with to the server's development mailbox. */
export const INTERNAL_TOKEN_HEADER = 'x-internal-token';

/** Where the server takes the worker's mails for the development mailbox. */
export const DEV_MAILS_PATH = '/api/dev/mails';

/**
 * The mailer of the worker: SMTP in production (or none, then nothing is mailed), locally the
 * server's development mailbox, which the worker reaches where it reaches the boards.
 */
export function createWorkerMailer(env: {
  NODE_ENV: 'development' | 'test' | 'production';
  SMTP_URL?: string | undefined;
  MAIL_FROM?: string | undefined;
  COLLAB_URL: string;
  INTERNAL_TOKEN: string;
}): Mailer | undefined {
  if (env.NODE_ENV === 'production') {
    return env.SMTP_URL && env.MAIL_FROM
      ? new SmtpMailer(nodemailer.createTransport(env.SMTP_URL), env.MAIL_FROM)
      : undefined;
  }
  if (env.NODE_ENV === 'test') return undefined;
  const server = new URL(env.COLLAB_URL);
  server.protocol = server.protocol === 'wss:' ? 'https:' : 'http:';
  return new ServerMailboxMailer(new URL(DEV_MAILS_PATH, server).href, env.INTERNAL_TOKEN);
}
