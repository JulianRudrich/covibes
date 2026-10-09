import { createHash } from 'node:crypto';

import type { Hono } from 'hono';

import { gitBlobId } from '@server/integrations/gitlab/blobs';

// What the example repositories of the development stand-in hold (spec 28b): a few files, issues
// and merge requests, so agents can read a repository without a GitLab. Milestones and issues can
// be created (spec 29b), and so can commits on new branches and merge requests (spec 29c); the
// stand-in keeps them until it restarts. The answers have the form of GitLab's API, as far as
// Covibes reads it.

type Person = { name: string; username: string };
type Note = { body: string; system: boolean; author: Person; created_at: string };

type ExampleIssue = {
  iid: number;
  title: string;
  state: 'opened' | 'closed';
  description: string;
  labels: string[];
  assignees: Person[];
  author: Person;
  updated_at: string;
  notes: Note[];
  /** Where its page is, and its milestone: only issues that were created name them. */
  web_url?: string;
  milestone?: { id: number; iid: number; title: string } | null;
};

type ExampleMilestone = {
  id: number;
  iid: number;
  title: string;
  description: string;
  state: 'active';
  web_url: string;
};

type ExampleMergeRequest = {
  iid: number;
  title: string;
  state: 'opened' | 'merged' | 'closed';
  draft: boolean;
  description: string;
  source_branch: string;
  target_branch: string;
  author: Person;
  updated_at: string;
  notes: Note[];
  /** Where its page is: only merge requests that were created name it. */
  web_url?: string;
  diffs: {
    old_path: string;
    new_path: string;
    new_file: boolean;
    deleted_file: boolean;
    renamed_file: boolean;
    diff: string;
  }[];
};

export type ExampleRepository = {
  /** The files of the default branch by their path; a Buffer is a file that is no text. */
  files: Readonly<Record<string, string | Buffer>>;
  issues: readonly ExampleIssue[];
  mergeRequests: readonly ExampleMergeRequest[];
};

const OLGA: Person = { name: 'Olga Beispiel', username: 'olga.beispiel' };
const SAM: Person = { name: 'Sam Muster', username: 'sam.muster' };

/** The Vereins-App: a small project at its very beginning, like the plan of the test project. */
const VEREINS_APP: ExampleRepository = {
  files: {
    'README.md': [
      '# Vereins-App',
      '',
      'Mitgliederliste, Beitragsstatus und öffentliche Trainingszeiten für unseren Sportverein.',
      '',
      '## Stand',
      '',
      'Das Grundgerüst steht: eine API mit Node.js und ein Frontend mit React. Die Anmeldung per',
      'E-Mail-Link ist in Arbeit (siehe Merge Request !1).',
      '',
      '## Entwicklung',
      '',
      '```',
      'npm install',
      'npm run dev',
      '```',
      '',
    ].join('\n'),
    'package.json': `${JSON.stringify(
      {
        name: 'vereins-app',
        private: true,
        scripts: { dev: 'node --watch src/api/server.js', test: 'node --test' },
        dependencies: { pg: '^8.13.0' },
      },
      null,
      2,
    )}\n`,
    'context/project-overview.md': [
      '# Projektübersicht',
      '',
      'Die erste Version kann: Mitglieder verwalten, den Beitragsstatus pflegen und die',
      'Trainingszeiten öffentlich zeigen. Anmeldung nur per E-Mail-Link, ohne Passwort.',
      '',
    ].join('\n'),
    'src/api/server.js': [
      "import { createServer } from 'node:http';",
      '',
      "import { listMembers } from './routes/members.js';",
      '',
      'const server = createServer(async (request, response) => {',
      "  if (request.method === 'GET' && request.url === '/api/members') {",
      "    response.setHeader('content-type', 'application/json');",
      '    response.end(JSON.stringify(await listMembers()));',
      '    return;',
      '  }',
      '  response.statusCode = 404;',
      '  response.end();',
      '});',
      '',
      'server.listen(3000);',
      '',
    ].join('\n'),
    'src/api/routes/members.js': [
      "import { pool } from '../db.js';",
      '',
      '/** Alle Mitglieder mit Namen und Beitragsstatus. */',
      'export async function listMembers() {',
      "  const { rows } = await pool.query('select id, name, fee_status from members order by name');",
      '  return rows;',
      '}',
      '',
    ].join('\n'),
    'src/api/db.js': [
      "import pg from 'pg';",
      '',
      'export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });',
      '',
    ].join('\n'),
    'src/web/App.jsx': ['export function App() {', '  return <h1>Vereins-App</h1>;', '}', ''].join(
      '\n',
    ),
    // The first bytes of a PNG: a file that is no text.
    'docs/logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]),
  },
  issues: [
    {
      iid: 1,
      title: 'Login per E-Mail-Link bauen',
      state: 'opened',
      description:
        'Mitglieder melden sich ohne Passwort an: Sie geben ihre E-Mail-Adresse ein und bekommen einen Link, der 15 Minuten gilt.\n\n- [ ] Endpunkt, der den Link verschickt\n- [ ] Endpunkt, der den Link einlöst\n- [ ] Login-Seite im Frontend',
      labels: ['Meilenstein 1'],
      assignees: [OLGA],
      author: OLGA,
      updated_at: '2026-10-02T09:30:00.000Z',
      notes: [
        {
          body: 'assigned to @olga.beispiel',
          system: true,
          author: OLGA,
          created_at: '2026-10-01T08:00:00.000Z',
        },
        {
          body: 'Über welchen Dienst verschicken wir die E-Mails? Das ist noch nicht entschieden.',
          system: false,
          author: SAM,
          created_at: '2026-10-01T10:15:00.000Z',
        },
        {
          body: 'Fürs Erste schreibe ich den Link nur ins Log, bis der Versanddienst feststeht.',
          system: false,
          author: OLGA,
          created_at: '2026-10-02T09:30:00.000Z',
        },
      ],
    },
    {
      iid: 2,
      title: 'Mitgliederliste im Frontend anzeigen',
      state: 'opened',
      description: 'Die Liste aus `GET /api/members` als Tabelle, sortiert nach Namen.',
      labels: ['Meilenstein 2'],
      assignees: [],
      author: SAM,
      updated_at: '2026-10-01T12:00:00.000Z',
      notes: [],
    },
    {
      iid: 3,
      title: 'Projekt aufsetzen',
      state: 'closed',
      description: 'Repository, Node.js-Projekt und erste Route.',
      labels: ['Meilenstein 1'],
      assignees: [SAM],
      author: OLGA,
      updated_at: '2026-09-28T16:45:00.000Z',
      notes: [],
    },
  ],
  mergeRequests: [
    {
      iid: 1,
      title: 'Login per E-Mail-Link',
      state: 'opened',
      draft: true,
      description:
        'Erster Teil von #1: Der Endpunkt erzeugt den Link und schreibt ihn ins Log. Der Versand per E-Mail folgt, sobald der Dienst feststeht.',
      source_branch: 'feature/login',
      target_branch: 'main',
      author: OLGA,
      updated_at: '2026-10-02T09:40:00.000Z',
      notes: [
        {
          body: 'added 1 commit',
          system: true,
          author: OLGA,
          created_at: '2026-10-02T09:35:00.000Z',
        },
        {
          body: 'Der Link sollte nur einmal gelten. Im Moment kann man ihn mehrfach einlösen.',
          system: false,
          author: SAM,
          created_at: '2026-10-02T11:00:00.000Z',
        },
      ],
      diffs: [
        {
          old_path: 'src/api/routes/login.js',
          new_path: 'src/api/routes/login.js',
          new_file: true,
          deleted_file: false,
          renamed_file: false,
          diff: [
            '@@ -0,0 +1,9 @@',
            "+import { randomBytes } from 'node:crypto';",
            '+',
            '+const links = new Map();',
            '+',
            '+/** Erzeugt einen Login-Link, der 15 Minuten gilt. */',
            '+export function createLoginLink(email) {',
            "+  const token = randomBytes(24).toString('hex');",
            '+  links.set(token, { email, expiresAt: Date.now() + 15 * 60_000 });',
            '+  return `/login/${token}`;',
            '+}',
            '',
          ].join('\n'),
        },
        {
          old_path: 'src/api/server.js',
          new_path: 'src/api/server.js',
          new_file: false,
          deleted_file: false,
          renamed_file: false,
          diff: [
            '@@ -1,5 +1,6 @@',
            " import { createServer } from 'node:http';",
            ' ',
            "+import { createLoginLink } from './routes/login.js';",
            " import { listMembers } from './routes/members.js';",
            ' ',
            ' const server = createServer(async (request, response) => {',
            '',
          ].join('\n'),
        },
      ],
    },
    {
      iid: 2,
      title: 'Projekt aufsetzen',
      state: 'merged',
      draft: false,
      description: 'Schließt #3.',
      source_branch: 'setup',
      target_branch: 'main',
      author: SAM,
      updated_at: '2026-09-28T16:40:00.000Z',
      notes: [],
      diffs: [],
    },
  ],
};

/** A repository that holds nothing but its README. */
const readmeOnly = (title: string, text: string): ExampleRepository => ({
  files: { 'README.md': `# ${title}\n\n${text}\n` },
  issues: [],
  mergeRequests: [],
});

/**
 * The website: it holds a progress tracker and a feature spec of an earlier plan package, so a
 * new package shows what stays and what is left over (spec 29c).
 */
const WEBSITE: ExampleRepository = {
  files: {
    'README.md': '# Website\n\nDie öffentliche Website des Vereins.\n',
    'context/progress-tracker.md': [
      '# Fortschritt',
      '',
      '## In Arbeit',
      '',
      'Startseite (seit 2026-10-01)',
      '',
    ].join('\n'),
    'context/feature-specs/01-09-alte-spec.md': '# 01-09 Alte Spec\n\nAus einem früheren Paket.\n',
  },
  issues: [],
  mergeRequests: [],
};

/** The content of the example repositories by their id in the stand-in. */
export const EXAMPLE_REPOSITORIES: Readonly<Record<number, ExampleRepository>> = {
  101: VEREINS_APP,
  102: WEBSITE,
  103: readmeOnly('Notizen', 'Olgas Notizen.'),
};

/** The files of a branch by their path; a Buffer is a file that is no text. */
type Files = Readonly<Record<string, string | Buffer>>;

/** A commit the stand-in took, for its page. */
export type ExampleCommit = {
  id: string;
  message: string;
  branch: string;
  web_url: string;
  files: { path: string; added: boolean }[];
};

/** One change of a commit, as GitLab's API takes it. */
export type CommitAction = { action: string; file_path: string; content: string };

/** A call the stand-in refuses, with GitLab's status and words. */
type Refusal = { status: 400 | 403 | 404 | 409; message: string };

const linesOf = (content: string | Buffer | undefined) =>
  content === undefined || Buffer.isBuffer(content) ? [] : content.replace(/\n$/, '').split('\n');

/** The changes between two branches as GitLab hands them out; a rough diff is enough here. */
function diffsBetween(source: Files, target: Files): ExampleMergeRequest['diffs'] {
  return Object.keys(source)
    .filter((path) => {
      const before = target[path];
      const after = source[path];
      return before === undefined || after === undefined || gitBlobId(before) !== gitBlobId(after);
    })
    .sort()
    .map((path) => {
      const before = linesOf(target[path]);
      const after = linesOf(source[path]);
      return {
        old_path: path,
        new_path: path,
        new_file: target[path] === undefined,
        deleted_file: false,
        renamed_file: false,
        diff: [
          `@@ -${before.length > 0 ? '1' : '0'},${String(before.length)} +1,${String(after.length)} @@`,
          ...before.map((line) => `-${line}`),
          ...after.map((line) => `+${line}`),
          '',
        ].join('\n'),
      };
    });
}

/** What was created in the example repositories since the stand-in started (specs 29b and 29c). */
export type ExampleStore = ReturnType<typeof createExampleStore>;

export function createExampleStore(now: () => number = Date.now) {
  const issues = new Map<number, ExampleIssue[]>();
  const milestones = new Map<number, ExampleMilestone[]>();
  // GitLab's ids of milestones count across all repositories.
  let milestoneId = 0;
  /** The branches that commits created, per repository, with the files each holds. */
  const branches = new Map<number, Map<string, Files>>();
  const mergeRequests = new Map<number, ExampleMergeRequest[]>();
  const commits = new Map<string, ExampleCommit>();

  /**
   * The files of a ref: the example's own for its default branch (`HEAD` names it too), what
   * commits made of a branch they created, and nothing for a ref that does not exist.
   */
  function filesOf(id: number, defaultBranch: string, ref?: string): Files | undefined {
    if (ref === undefined || ref === defaultBranch || ref === 'HEAD') {
      return EXAMPLE_REPOSITORIES[id]?.files;
    }
    return branches.get(id)?.get(ref);
  }
  const mergeRequestsOf = (id: number): readonly ExampleMergeRequest[] => [
    ...(EXAMPLE_REPOSITORIES[id]?.mergeRequests ?? []),
    ...(mergeRequests.get(id) ?? []),
  ];

  const issuesOf = (id: number): readonly ExampleIssue[] => [
    ...(EXAMPLE_REPOSITORIES[id]?.issues ?? []),
    ...(issues.get(id) ?? []),
  ];
  const milestonesOf = (id: number): readonly ExampleMilestone[] => milestones.get(id) ?? [];

  return {
    issuesOf,
    milestonesOf,
    filesOf,
    mergeRequestsOf,
    /** The branches of a repository: its default branch and what commits created. */
    branchesOf: (id: number, defaultBranch: string) => [
      defaultBranch,
      ...(branches.get(id)?.keys() ?? []),
    ],
    commitOf: (sha: string) => commits.get(sha),
    /**
     * A commit as GitLab's API takes it: on a branch that commits created, or on a new one that
     * starts from another. The default branch is protected, as it usually is.
     */
    commit(
      id: number,
      target: ExampleTarget,
      input: { branch: string; startBranch?: string; message: string; actions: CommitAction[] },
    ): ExampleCommit | Refusal {
      const own = branches.get(id) ?? new Map<string, Files>();
      const existing = own.get(input.branch);
      if (input.branch === target.defaultBranch) {
        return { status: 403, message: 'You are not allowed to push into this branch' };
      }
      if (existing && input.startBranch !== undefined) {
        return { status: 400, message: `A branch called '${input.branch}' already exists` };
      }
      const start =
        existing ??
        (input.startBranch === undefined
          ? undefined
          : filesOf(id, target.defaultBranch, input.startBranch));
      if (!start) {
        return {
          status: 400,
          message: 'You can only create or edit files when you are on a branch',
        };
      }
      if (input.actions.length === 0) return { status: 400, message: 'actions is empty' };
      const files: Record<string, string | Buffer> = { ...start };
      for (const action of input.actions) {
        const held = files[action.file_path] !== undefined;
        if (action.action === 'create' && held) {
          return { status: 400, message: 'A file with this name already exists' };
        }
        if (action.action === 'update' && !held) {
          return { status: 400, message: "A file with this name doesn't exist" };
        }
        if (action.action !== 'create' && action.action !== 'update') {
          return { status: 400, message: 'actions[action] does not have a valid value' };
        }
        files[action.file_path] = action.content;
      }
      own.set(input.branch, files);
      branches.set(id, own);
      const sha = createHash('sha1')
        .update(`${String(id)} ${input.branch} ${String(now())} ${String(commits.size)}`)
        .digest('hex');
      const commit: ExampleCommit = {
        id: sha,
        message: input.message,
        branch: input.branch,
        web_url: `${target.webUrl}/-/commit/${sha}`,
        files: input.actions.map((action) => ({
          path: action.file_path,
          added: action.action === 'create',
        })),
      };
      commits.set(sha, commit);
      return commit;
    },
    /** A merge request as GitLab's API opens it: one per source branch while it is open. */
    addMergeRequest(
      id: number,
      target: ExampleTarget,
      fields: { title: string; description: string; sourceBranch: string; targetBranch: string },
    ): ExampleMergeRequest | Refusal {
      const source = filesOf(id, target.defaultBranch, fields.sourceBranch);
      const into = filesOf(id, target.defaultBranch, fields.targetBranch);
      if (!source || !into) {
        return { status: 400, message: 'The source or the target branch does not exist' };
      }
      const open = mergeRequestsOf(id).find(
        (entry) => entry.state === 'opened' && entry.source_branch === fields.sourceBranch,
      );
      if (open) {
        return {
          status: 409,
          message: `Another open merge request already exists for this source branch: !${String(open.iid)}`,
        };
      }
      const iid = Math.max(0, ...mergeRequestsOf(id).map((entry) => entry.iid)) + 1;
      const mergeRequest: ExampleMergeRequest = {
        iid,
        title: fields.title,
        state: 'opened',
        draft: false,
        description: fields.description,
        source_branch: fields.sourceBranch,
        target_branch: fields.targetBranch,
        author: OLGA,
        updated_at: new Date(now()).toISOString(),
        notes: [],
        web_url: `${target.webUrl}/-/merge_requests/${String(iid)}`,
        diffs: diffsBetween(source, into),
      };
      mergeRequests.set(id, [...(mergeRequests.get(id) ?? []), mergeRequest]);
      return mergeRequest;
    },
    addMilestone(id: number, webUrl: string, title: string, description: string) {
      const iid = milestonesOf(id).length + 1;
      milestoneId += 1;
      const milestone: ExampleMilestone = {
        id: milestoneId,
        iid,
        title,
        description,
        state: 'active',
        web_url: `${webUrl}/-/milestones/${String(iid)}`,
      };
      milestones.set(id, [...milestonesOf(id), milestone]);
      return milestone;
    },
    addIssue(
      id: number,
      webUrl: string,
      fields: { title: string; description: string; milestone: ExampleMilestone | null },
    ) {
      const iid = Math.max(0, ...issuesOf(id).map((issue) => issue.iid)) + 1;
      const issue: ExampleIssue = {
        iid,
        title: fields.title,
        state: 'opened',
        description: fields.description,
        labels: [],
        assignees: [],
        author: OLGA,
        updated_at: new Date(now()).toISOString(),
        notes: [],
        web_url: `${webUrl}/-/issues/${String(iid)}`,
        milestone: fields.milestone
          ? { id: fields.milestone.id, iid: fields.milestone.iid, title: fields.milestone.title }
          : null,
      };
      issues.set(id, [...(issues.get(id) ?? []), issue]);
      return issue;
    },
  };
}

/** A repository of the stand-in, as far as its content needs to know it. */
export type ExampleTarget = {
  defaultBranch: string;
  /** Where its pages are. */
  webUrl: string;
  /** Whether it has issues at all; GitLab refuses to create one where they are switched off. */
  issuesEnabled: boolean;
};

/** The direct children of a folder, as GitLab lists a tree; undefined for a folder that is not there. */
function tree(files: ExampleRepository['files'], folder: string) {
  const prefix = folder ? `${folder}/` : '';
  const entries = new Map<string, { id: string; name: string; type: string; path: string }>();
  for (const path of Object.keys(files)) {
    if (!path.startsWith(prefix)) continue;
    const [name = '', ...rest] = path.slice(prefix.length).split('/');
    const content = files[path];
    entries.set(name, {
      // A file carries Git's mark of its content, as GitLab hands it out.
      id: rest.length > 0 || content === undefined ? `${prefix}${name}` : gitBlobId(content),
      name,
      type: rest.length > 0 ? 'tree' : 'blob',
      path: `${prefix}${name}`,
    });
  }
  return entries.size > 0 || folder === '' ? [...entries.values()] : undefined;
}

/**
 * Adds the routes of GitLab's API for the content of the example repositories: reading files,
 * issues and merge requests, and creating milestones, issues, commits and merge requests.
 * `targetOf` says what the stand-in knows of a repository.
 */
export function addExampleRepositoryRoutes(
  routes: Hono,
  targetOf: (id: number) => ExampleTarget | undefined,
  store: ExampleStore,
): void {
  const notFound = { message: '404 Not Found' };

  /** The repository of a request, with what was created in it, if the stand-in has it. */
  function find(id: string | undefined, ref?: string) {
    const numeric = Number(id);
    const repository = EXAMPLE_REPOSITORIES[numeric];
    const target = targetOf(numeric);
    if (!repository || !target) return undefined;
    // An example has its default branch, and the branches that commits created.
    const files = store.filesOf(numeric, target.defaultBranch, ref);
    if (!files) return undefined;
    return {
      ...target,
      target,
      id: numeric,
      files,
      issues: store.issuesOf(numeric),
      milestones: store.milestonesOf(numeric),
      mergeRequests: store.mergeRequestsOf(numeric),
    };
  }

  routes.get('/api/v4/projects/:id/repository/tree', (c) => {
    const repository = find(c.req.param('id'), c.req.query('ref'));
    const entries = repository ? tree(repository.files, c.req.query('path') ?? '') : undefined;
    if (!entries) return c.json({ message: '404 Tree Not Found' }, 404);
    const perPage = Number(c.req.query('per_page') ?? 20);
    const page = Number(c.req.query('page') ?? 1);
    return c.json(entries.slice((page - 1) * perPage, page * perPage));
  });

  routes.get('/api/v4/projects/:id/repository/files/:path', (c) => {
    const repository = find(c.req.param('id'), c.req.query('ref'));
    const path = c.req.param('path');
    const content = repository?.files[path];
    if (content === undefined) return c.json({ message: '404 File Not Found' }, 404);
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    return c.json({
      file_name: path.split('/').at(-1),
      file_path: path,
      size: bytes.length,
      encoding: 'base64',
      content: bytes.toString('base64'),
      ref: c.req.query('ref'),
    });
  });

  /**
   * A list by state and search, the latest changed first, as GitLab orders it when asked to. The
   * search looks at the title, or where `where` says ("description").
   */
  function listed<
    T extends { state: string; title: string; description: string; updated_at: string },
  >(
    items: readonly T[],
    state: string | undefined,
    search: string | undefined,
    where = 'title',
  ): T[] {
    const term = (search ?? '').toLowerCase();
    const places = where.split(',');
    return items
      .filter((item) => !state || state === 'all' || item.state === state)
      .filter(
        (item) =>
          (places.includes('title') && item.title.toLowerCase().includes(term)) ||
          (places.includes('description') && item.description.toLowerCase().includes(term)),
      )
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  /** An entry without what GitLab hands out in calls of its own. */
  function without<T extends object, K extends keyof T & string>(
    item: T,
    keys: readonly K[],
  ): Omit<T, K> {
    return Object.fromEntries(
      Object.entries(item).filter(([key]) => !(keys as readonly string[]).includes(key)),
    ) as Omit<T, K>;
  }
  const withoutNotes = <T extends { notes: unknown }>(item: T) => without(item, ['notes']);
  const withoutDetails = <T extends { notes: unknown; diffs: unknown }>(item: T) =>
    without(item, ['notes', 'diffs']);

  routes.get('/api/v4/projects/:id/issues', (c) => {
    const repository = find(c.req.param('id'));
    if (!repository) return c.json(notFound, 404);
    return c.json(
      listed(repository.issues, c.req.query('state'), c.req.query('search'), c.req.query('in')).map(
        withoutNotes,
      ),
    );
  });

  /** The body of a writing call as an object; undefined if it is none. */
  async function fields(request: { json: () => Promise<unknown> }) {
    const body = await request.json().catch(() => undefined);
    return typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
  }
  const text = (value: unknown) => (typeof value === 'string' ? value : '');

  routes.post('/api/v4/projects/:id/issues', async (c) => {
    const repository = find(c.req.param('id'));
    if (!repository) return c.json(notFound, 404);
    if (!repository.issuesEnabled) return c.json({ message: '403 Forbidden' }, 403);
    const body = await fields(c.req);
    const title = text(body?.title).trim();
    if (!title) return c.json({ message: { title: ["can't be blank"] } }, 400);
    if (title.length > 255) {
      return c.json({ message: { title: ['is too long (maximum is 255 characters)'] } }, 400);
    }
    const milestoneId = body?.milestone_id;
    const milestone = repository.milestones.find((entry) => entry.id === milestoneId);
    // Like GitLab, a milestone that does not belong to the repository is left out.
    const issue = store.addIssue(repository.id, repository.webUrl, {
      title,
      description: text(body?.description),
      milestone: milestone ?? null,
    });
    return c.json(withoutNotes(issue), 201);
  });

  routes.get('/api/v4/projects/:id/milestones', (c) => {
    const repository = find(c.req.param('id'));
    if (!repository) return c.json(notFound, 404);
    const title = c.req.query('title');
    return c.json(
      repository.milestones.filter((entry) => title === undefined || entry.title === title),
    );
  });

  routes.post('/api/v4/projects/:id/milestones', async (c) => {
    const repository = find(c.req.param('id'));
    if (!repository) return c.json(notFound, 404);
    const body = await fields(c.req);
    const title = text(body?.title).trim();
    if (!title) return c.json({ message: { title: ["can't be blank"] } }, 400);
    if (repository.milestones.some((entry) => entry.title === title)) {
      return c.json({ message: { title: ['has already been taken'] } }, 400);
    }
    return c.json(
      store.addMilestone(repository.id, repository.webUrl, title, text(body?.description)),
      201,
    );
  });

  routes.get('/api/v4/projects/:id/issues/:iid', (c) => {
    const issue = find(c.req.param('id'))?.issues.find(
      (entry) => String(entry.iid) === c.req.param('iid'),
    );
    return issue ? c.json(withoutNotes(issue)) : c.json(notFound, 404);
  });

  routes.get('/api/v4/projects/:id/issues/:iid/notes', (c) => {
    const issue = find(c.req.param('id'))?.issues.find(
      (entry) => String(entry.iid) === c.req.param('iid'),
    );
    return issue ? c.json(issue.notes) : c.json(notFound, 404);
  });

  routes.get('/api/v4/projects/:id/merge_requests', (c) => {
    const repository = find(c.req.param('id'));
    if (!repository) return c.json(notFound, 404);
    const source = c.req.query('source_branch');
    const into = c.req.query('target_branch');
    return c.json(
      listed(repository.mergeRequests, c.req.query('state'), undefined)
        .filter((entry) => source === undefined || entry.source_branch === source)
        .filter((entry) => into === undefined || entry.target_branch === into)
        .map(withoutDetails),
    );
  });

  routes.post('/api/v4/projects/:id/merge_requests', async (c) => {
    const repository = find(c.req.param('id'));
    if (!repository) return c.json(notFound, 404);
    const body = await fields(c.req);
    const title = text(body?.title).trim();
    if (!title) return c.json({ message: { title: ["can't be blank"] } }, 400);
    const created = store.addMergeRequest(repository.id, repository.target, {
      title,
      description: text(body?.description),
      sourceBranch: text(body?.source_branch),
      targetBranch: text(body?.target_branch),
    });
    if ('status' in created) return c.json({ message: created.message }, created.status);
    return c.json(withoutDetails(created), 201);
  });

  routes.post('/api/v4/projects/:id/repository/commits', async (c) => {
    const repository = find(c.req.param('id'));
    if (!repository) return c.json(notFound, 404);
    const body = await fields(c.req);
    const branch = text(body?.branch);
    const message = text(body?.commit_message);
    if (!branch || !message) {
      return c.json({ message: 'branch is missing, commit_message is missing' }, 400);
    }
    const actions = (Array.isArray(body?.actions) ? (body.actions as unknown[]) : []).map(
      (entry) => {
        const action = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<
          string,
          unknown
        >;
        return {
          action: text(action.action),
          file_path: text(action.file_path),
          content: text(action.content),
        };
      },
    );
    const created = store.commit(repository.id, repository.target, {
      branch,
      ...(typeof body?.start_branch === 'string' ? { startBranch: body.start_branch } : {}),
      message,
      actions,
    });
    if ('status' in created) return c.json({ message: created.message }, created.status);
    return c.json(
      {
        id: created.id,
        short_id: created.id.slice(0, 8),
        title: created.message.split('\n')[0],
        message: created.message,
        web_url: created.web_url,
      },
      201,
    );
  });

  const mergeRequest = (id: string | undefined, iid: string | undefined) =>
    find(id)?.mergeRequests.find((entry) => String(entry.iid) === iid);

  routes.get('/api/v4/projects/:id/merge_requests/:iid', (c) => {
    const found = mergeRequest(c.req.param('id'), c.req.param('iid'));
    return found ? c.json(withoutDetails(found)) : c.json(notFound, 404);
  });

  routes.get('/api/v4/projects/:id/merge_requests/:iid/diffs', (c) => {
    const found = mergeRequest(c.req.param('id'), c.req.param('iid'));
    return found ? c.json(found.diffs) : c.json(notFound, 404);
  });

  routes.get('/api/v4/projects/:id/merge_requests/:iid/notes', (c) => {
    const found = mergeRequest(c.req.param('id'), c.req.param('iid'));
    return found ? c.json(found.notes) : c.json(notFound, 404);
  });
}
