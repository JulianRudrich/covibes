import type { Mail } from '@server/integrations/mail/mailer';

const MAGIC_LINK_TEXT = {
  de: {
    subject: 'Dein Login-Link für Covibes',
    body: (url: string, minutes: number) =>
      `Hallo,\n\nmit diesem Link meldest du dich bei Covibes an:\n\n${url}\n\nDer Link gilt ${String(minutes)} Minuten und nur einmal. Wenn du ihn nicht angefordert hast, kannst du diese Mail ignorieren.`,
  },
  en: {
    subject: 'Your Covibes login link',
    body: (url: string, minutes: number) =>
      `Hello,\n\nuse this link to sign in to Covibes:\n\n${url}\n\nThe link is valid for ${String(minutes)} minutes and can be used once. If you did not request it, you can ignore this email.`,
  },
} as const;

export function magicLinkMail(options: {
  to: string;
  url: string;
  minutes: number;
  locale?: 'de' | 'en';
}): Mail {
  const text = MAGIC_LINK_TEXT[options.locale ?? 'de'];
  return { to: options.to, subject: text.subject, text: text.body(options.url, options.minutes) };
}
