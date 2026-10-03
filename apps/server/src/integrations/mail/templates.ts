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

/** One line of the notification mail (spec 22b). */
export type DigestItem =
  | { kind: 'mention'; actorName: string; excerpt: string }
  | { kind: 'task_assigned'; actorName: string; excerpt: string }
  | { kind: 'role_changed'; actorName: string; role: 'owner' | 'editor' | 'viewer' }
  | { kind: 'removed'; actorName: string }
  | { kind: 'waiting'; count: number };

/** What the mail says about one project; `url` is null when the person can no longer open it. */
export type DigestProject = { name: string; url: string | null; items: DigestItem[] };

const DIGEST_ROLES = {
  de: { owner: 'Owner', editor: 'Bearbeiter', viewer: 'Leser' },
  en: { owner: 'owner', editor: 'editor', viewer: 'viewer' },
} as const;

const DIGEST_TEXT = {
  de: {
    someone: 'Jemand',
    subjectMention: (actor: string, project: string) => `${actor} hat dich in „${project}“ erwähnt`,
    subjectOne: (project: string) => `Neues für dich in „${project}“`,
    subjectMany: (count: number) => `Neues für dich in ${String(count)} Projekten`,
    hello: (name: string) => `Hallo ${name},`,
    intro: 'das hast du in Covibes noch nicht gesehen:',
    project: (name: string) => `„${name}“`,
    item: (item: DigestItem, actor: string) => {
      switch (item.kind) {
        case 'mention':
          return `${actor} hat dich erwähnt: „${item.excerpt}“`;
        case 'task_assigned':
          return `${actor} hat dir eine Aufgabe zugewiesen: ${item.excerpt}`;
        case 'role_changed':
          return `${actor} hat deine Rolle geändert: ${DIGEST_ROLES.de[item.role]}`;
        case 'removed':
          return `${actor} hat dich aus dem Projekt entfernt.`;
        case 'waiting':
          return item.count === 1
            ? '1 Sache wartet auf dich (ein Vorschlag, ein Handzeichen oder eine Abstimmung).'
            : `${String(item.count)} Dinge warten auf dich (Vorschläge, Handzeichen oder Abstimmungen).`;
      }
    },
    footer: (url: string) =>
      `Covibes schreibt dir höchstens alle 30 Minuten und nur über das, was du in der App noch nicht gesehen hast. Abstellen kannst du diese Mails im Konto-Menü unter „E-Mail-Benachrichtigungen“: ${url}`,
  },
  en: {
    someone: 'Someone',
    subjectMention: (actor: string, project: string) => `${actor} mentioned you in "${project}"`,
    subjectOne: (project: string) => `News for you in "${project}"`,
    subjectMany: (count: number) => `News for you in ${String(count)} projects`,
    hello: (name: string) => `Hello ${name},`,
    intro: 'you have not seen this in Covibes yet:',
    project: (name: string) => `"${name}"`,
    item: (item: DigestItem, actor: string) => {
      switch (item.kind) {
        case 'mention':
          return `${actor} mentioned you: "${item.excerpt}"`;
        case 'task_assigned':
          return `${actor} assigned you a task: ${item.excerpt}`;
        case 'role_changed':
          return `${actor} changed your role: ${DIGEST_ROLES.en[item.role]}`;
        case 'removed':
          return `${actor} removed you from the project.`;
        case 'waiting':
          return item.count === 1
            ? '1 thing waits for you (a proposal, a raised hand or a vote).'
            : `${String(item.count)} things wait for you (proposals, raised hands or votes).`;
      }
    },
    footer: (url: string) =>
      `Covibes writes to you at most every 30 minutes, and only about what you have not seen in the app. You can turn these mails off in the account menu under "Email notifications": ${url}`,
  },
} as const;

/**
 * The notification mail (spec 22b): what a person has not seen in the app, grouped by project, as
 * plain text in their language. Names, message texts and the texts of tasks come from people, so
 * each is one line.
 */
export function notificationDigestMail(options: {
  to: string;
  name: string;
  projects: readonly DigestProject[];
  appUrl: string;
  locale?: 'de' | 'en';
}): Mail {
  const text = DIGEST_TEXT[options.locale ?? 'de'];
  const actorOf = (item: DigestItem) =>
    'actorName' in item ? oneLine(item.actorName, 80) || text.someone : '';
  const projects = options.projects.map((project) => ({
    ...project,
    name: oneLine(project.name, 120),
    items: project.items.map((item) =>
      'excerpt' in item ? { ...item, excerpt: oneLine(item.excerpt, 200) } : item,
    ),
  }));

  const [first] = projects;
  const [only] = first?.items ?? [];
  const subject =
    projects.length === 1 && first?.items.length === 1 && only?.kind === 'mention'
      ? text.subjectMention(actorOf(only), first.name)
      : projects.length === 1 && first
        ? text.subjectOne(first.name)
        : text.subjectMany(projects.length);

  const sections = projects.map((project) =>
    [
      text.project(project.name),
      ...(project.url ? [project.url] : []),
      ...project.items.map((item) => `- ${text.item(item, actorOf(item))}`),
    ].join('\n'),
  );
  return {
    to: options.to,
    subject,
    text: [
      text.hello(oneLine(options.name, 80)),
      text.intro,
      ...sections,
      text.footer(options.appUrl),
    ].join('\n\n'),
  };
}
