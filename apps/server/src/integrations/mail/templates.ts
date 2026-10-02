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

const ROLE_NAMES = {
  de: { editor: 'Bearbeiter (mitarbeiten)', viewer: 'Leser (nur lesen)' },
  en: { editor: 'editor (work along)', viewer: 'viewer (read only)' },
} as const;

const INVITATION_TEXT = {
  de: {
    subject: (project: string) => `Einladung zum Projekt „${project}“ in Covibes`,
    body: (o: { inviter: string; project: string; role: string; url: string; days: number }) =>
      `Hallo,\n\n${o.inviter} lädt dich ein, im Projekt „${o.project}“ in Covibes mitzumachen, als ${o.role}.\n\nMit diesem Link trittst du bei:\n\n${o.url}\n\nDer Link gilt ${String(o.days)} Tage und nur einmal. Wenn du die Einladung nicht erwartest, kannst du diese Mail ignorieren.`,
  },
  en: {
    subject: (project: string) => `Invitation to the project "${project}" in Covibes`,
    body: (o: { inviter: string; project: string; role: string; url: string; days: number }) =>
      `Hello,\n\n${o.inviter} invites you to join the project "${o.project}" in Covibes as ${o.role}.\n\nUse this link to join:\n\n${o.url}\n\nThe link is valid for ${String(o.days)} days and can be used once. If you did not expect this invitation, you can ignore this email.`,
  },
} as const;

/** Names come from people: one line, no control characters, and not endlessly long. */
function oneLine(text: string, max: number): string {
  const clean = Array.from(text, (character) => (character.charCodeAt(0) < 0x20 ? ' ' : character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** The mail of an invitation by email (spec 21a), in the language of the project. */
export function invitationMail(options: {
  to: string;
  url: string;
  projectName: string;
  inviterName: string;
  role: 'editor' | 'viewer';
  days: number;
  locale?: 'de' | 'en';
}): Mail {
  const locale = options.locale ?? 'de';
  const text = INVITATION_TEXT[locale];
  const project = oneLine(options.projectName, 120);
  return {
    to: options.to,
    subject: text.subject(project),
    text: text.body({
      inviter: oneLine(options.inviterName, 80) || (locale === 'de' ? 'Jemand' : 'Someone'),
      project,
      role: ROLE_NAMES[locale][options.role],
      url: options.url,
      days: options.days,
    }),
  };
}
