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
 * them under /dev/mails. Real delivery (SMTP) comes with the deployment.
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
