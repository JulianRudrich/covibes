import type {
  AwaySummary,
  Decision,
  LiveEvent,
  PlanState,
  ProjectBoard,
  ProjectDetails,
  ProjectSummary,
  PublicConfig,
  SharedProject,
} from '@covibes/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CUSTOM_MARKS } from '@web/components/ui/agent-marks';
import { authClient } from '@web/lib/auth-client';
import { PHONE_QUERY } from '@web/lib/use-media-query';
import { renderApp, stubApi } from '@web/test-utils';

vi.mock('@web/lib/auth-client', () => ({
  authClient: {
    getSession: vi.fn(),
    signIn: { magicLink: vi.fn(), social: vi.fn() },
    signOut: vi.fn(),
    updateUser: vi.fn(),
  },
}));

// What the stand-in for the chat refers to (spec 37a); `vi.mock` is hoisted, so is this.
const REFERENCES = vi.hoisted(() => ({
  Haupt: {
    boardId: '33333333-3333-4333-8333-333333333333',
    nodeId: 'aaaaaaaa-0000-4000-8000-000000000001',
  },
  Ablauf: {
    boardId: '44444444-4444-4444-8444-444444444444',
    nodeId: 'aaaaaaaa-0000-4000-8000-000000000002',
  },
}));

// Canvas and chat need the live server; their parts have their own tests.
vi.mock('@web/features/chat/chat-panel', async () => {
  const { createElement } = await import('react');
  return {
    ChatPanel: (props: {
      projectId: string;
      readOnly: boolean;
      onOpenReference?: (reference: { boardId: string; nodeId: string }) => void;
    }) =>
      createElement(
        'div',
        {
          'data-testid': 'chat-panel',
          'data-project': props.projectId,
          'data-readonly': String(props.readOnly),
        },
        // Stand for references in messages (spec 37a): to an element of the main canvas and
        // to one of another board.
        ...Object.entries(REFERENCES).map(([name, reference]) =>
          createElement(
            'button',
            { key: name, onClick: () => props.onOpenReference?.(reference) },
            `Verweis ${name}`,
          ),
        ),
      ),
  };
});
vi.mock('@web/features/canvas/canvas-panel', async () => {
  const { createElement } = await import('react');
  return {
    CanvasPanel: (props: {
      boardId: string;
      tabs: ReactNode;
      readOnly: boolean;
      notice: string | null;
      focusId?: string;
      onFocused?: () => void;
      onFocusMissing?: () => void;
      exports?: { title: string; fileName: string; language: string; onFailed: () => void };
    }) =>
      createElement(
        'div',
        {
          'data-testid': 'canvas-panel',
          'data-board': props.boardId,
          'data-readonly': String(props.readOnly),
          'data-focus': props.focusId ?? '',
          'data-notice': props.notice ?? '',
          'data-export': props.exports
            ? `${props.exports.fileName}|${props.exports.title}|${props.exports.language}`
            : '',
          // Stands for an export that gave no file.
          onDoubleClick: props.exports?.onFailed,
        },
        // The tabs of the header stay real, like those of the plan (spec 38a: the history).
        props.tabs,
        props.notice,
        props.focusId ? createElement('button', { onClick: props.onFocused }, 'Im Blick') : null,
        // Stands for an element that never came (spec 37a).
        props.focusId
          ? createElement('button', { onClick: props.onFocusMissing }, 'Nicht da')
          : null,
      ),
  };
});
// The plan needs the collaboration server; its editor and its suggestions have their own tests.
// The tabs stay real, and the plan's actions are two plain buttons.
vi.mock('@web/features/plan/plan-panel', async () => {
  const { createElement } = await import('react');
  return {
    PlanPanel: (props: {
      projectId: string;
      readOnly: boolean;
      language: string;
      tabs: ReactNode;
      notice: string | null;
      plan?: PlanState;
      onGenerate?: () => void;
      onDecide?: (decision: { suggestionId: string | null; decision: 'accept' }) => void;
      onUpdate?: () => void;
      onOpenRoadmap: () => void;
      roadmapBusy: boolean;
      projectName: string;
      onExportFailed: () => void;
      tasks?: {
        assignees: ReadonlyMap<string, { userId: string; name: string } | null>;
        assigning?: {
          members: readonly { userId: string; name: string }[];
          onAssign: (taskId: string, assignee: { userId: string; name: string } | null) => void;
        };
      };
    }) =>
      createElement(
        'div',
        {
          'data-testid': 'plan-panel',
          'data-project': props.projectId,
          'data-readonly': String(props.readOnly),
          'data-language': props.language,
          'data-suggestions': String(props.plan?.suggestions.length ?? 'loading'),
          'data-generating': String(props.plan?.generating ?? 'loading'),
          'data-outdated': String(props.plan ? props.plan.outdated !== null : 'loading'),
          'data-tasks': props.tasks
            ? [...props.tasks.assignees]
                .map(([id, assignee]) => `${id.slice(0, 4)}:${assignee?.name ?? '-'}`)
                .join(' ')
            : 'loading',
          'data-project-name': props.projectName,
          'data-members':
            props.tasks?.assigning?.members.map((member) => member.name).join(',') ?? '',
        },
        props.tabs,
        props.notice,
        props.onGenerate
          ? createElement('button', { onClick: props.onGenerate }, 'Plan erzeugen')
          : null,
        props.onUpdate
          ? createElement('button', { onClick: props.onUpdate }, 'Aktualisieren')
          : null,
        createElement(
          'button',
          { onClick: props.onOpenRoadmap, disabled: props.roadmapBusy },
          'Roadmap',
        ),
        props.tasks?.assigning
          ? createElement(
              'button',
              {
                onClick: () => {
                  const [first] = props.tasks?.assignees.keys() ?? [];
                  const [member] = props.tasks?.assigning?.members ?? [];
                  if (first && member) props.tasks?.assigning?.onAssign(first, member);
                },
              },
              'Erste Aufgabe zuweisen',
            )
          : null,
        props.onDecide
          ? createElement(
              'button',
              {
                onClick: () => {
                  props.onDecide?.({ suggestionId: null, decision: 'accept' });
                },
              },
              'Alle übernehmen',
            )
          : null,
      ),
  };
});
// The read-only canvas needs a measuring browser like the live one.
vi.mock('@web/features/share/shared-board', async () => {
  const { createElement } = await import('react');
  return {
    SharedBoardCanvas: (props: { nodes: { label: string }[] }) =>
      createElement(
        'div',
        { 'data-testid': 'shared-board' },
        props.nodes.map((node) => node.label).join(', '),
      ),
  };
});
// The live channel is replaced; tests send its events by hand.
const live = vi.hoisted(() => ({
  handlers: undefined as undefined | { onEvent: (event: LiveEvent) => void; onConnect: () => void },
}));
vi.mock('@web/features/realtime/live-channel', () => ({
  useLiveChannel: (
    _projectId: string,
    handlers: { onEvent: (event: LiveEvent) => void; onConnect: () => void },
  ) => {
    live.handlers = handlers;
  },
}));

const OLGA = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Olga',
  email: 'olga@example.com',
};
const PROJECT: ProjectSummary = {
  id: '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de',
  name: 'Covibes V1',
  role: 'owner',
  updatedAt: new Date().toISOString(),
  waiting: 0,
  phase: 'brainstorming',
  members: [{ userId: '11111111-1111-4111-8111-111111111111', name: 'Olga' }],
  agents: [{ key: 'moderator', custom: null }],
};
const DETAILS: ProjectDetails = {
  id: PROJECT.id,
  name: PROJECT.name,
  role: 'owner',
  members: [
    {
      userId: '22222222-2222-4222-8222-222222222222',
      name: 'Alex Berg',
      role: 'editor',
      canApproveGit: false,
    },
    { userId: OLGA.id, name: OLGA.name, role: 'owner', canApproveGit: true },
  ],
  boards: [{ id: '33333333-3333-4333-8333-333333333333', title: 'Haupt-Canvas', kind: 'main' }],
  proposalsOnly: false,
  observer: true,
  webAccess: true,
  stance: 'criteria',
  decisionProcess: 'consensus',
  phase: 'architecture',
  language: 'de',
  agents: [{ key: 'moderator', model: null }],
  customAgents: [],
};
const EXTRA_BOARD: ProjectBoard = {
  id: '44444444-4444-4444-8444-444444444444',
  title: 'Ablauf',
  kind: 'extra',
};
const CONFIG: PublicConfig = { gitlabLogin: false, emailLogin: true, devMailbox: true };
const CANVAS_DECISION: Decision = {
  id: '55555555-5555-4555-8555-555555555555',
  topic: 'Canvas',
  status: 'decided',
  value: 'React Flow',
  reasoning: 'Strukturierte Blöcke und MIT-Lizenz.',
  alternatives: [],
  decidedBy: 'Alex Berg',
  decidedAt: '2026-10-01T18:00:00.000Z',
  reopenReason: null,
  comparison: null,
  tally: null,
  variants: null,
};
/** What happened while Olga was away since yesterday (spec 23). */
const AWAY: AwaySummary = {
  since: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
  until: new Date().toISOString(),
  text: 'Alex hat React Flow vorgeschlagen, und der Moderator hat es festgehalten.',
  textStatus: 'done',
  decisions: [
    {
      id: '66666666-6666-4666-8666-666666666666',
      kind: 'decided',
      decisionId: CANVAS_DECISION.id,
      topic: 'Canvas',
      value: 'React Flow',
    },
  ],
  criteriaChanges: 0,
  planVersions: 0,
  boards: [
    {
      boardId: EXTRA_BOARD.id,
      title: EXTRA_BOARD.title,
      isNew: true,
      changed: 4,
      by: [{ kind: 'human', name: 'Alex Berg' }],
      authors: 1,
    },
  ],
  messages: { count: 6, mentions: 0, by: [{ kind: 'human', name: 'Alex Berg' }], authors: 1 },
};

/** A screen as narrow as a phone (spec 36e); the stub goes with the test's other globals. */
function onPhone() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === PHONE_QUERY,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function signedIn(user: (typeof OLGA & { locale?: string }) | null) {
  vi.mocked(authClient.getSession).mockResolvedValue({
    data: user ? { user, session: {} } : null,
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authClient.signIn.magicLink).mockResolvedValue({ data: {}, error: null });
  vi.mocked(authClient.signOut).mockResolvedValue({ data: {}, error: null });
  vi.mocked(authClient.updateUser).mockResolvedValue({ data: { status: true }, error: null });
});

describe('without a session', () => {
  beforeEach(() => {
    signedIn(null);
    stubApi({ 'GET /api/config': () => ({ body: CONFIG }) });
  });

  it('sends every page to the login and remembers where it came from', async () => {
    const router = renderApp(`/p/${PROJECT.id}`);

    expect(
      await screen.findByRole('heading', { name: 'Bei Covibes anmelden' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
    expect(router.state.location.search).toEqual({ redirect: `/p/${PROJECT.id}` });
  });

  it('offers only the social providers configured by the server', async () => {
    renderApp('/login');

    await screen.findByRole('heading', { name: 'Bei Covibes anmelden' });
    expect(screen.queryByRole('button', { name: /GitLab/ })).not.toBeInTheDocument();
  });

  it('sends a login link that leads back to the original page', async () => {
    renderApp(`/login?redirect=${encodeURIComponent(`/p/${PROJECT.id}`)}`);

    const email = await screen.findByLabelText('E-Mail-Adresse');
    fireEvent.change(email, { target: { value: 'kein-at-zeichen' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login-Link senden' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('gültige E-Mail-Adresse');
    expect(authClient.signIn.magicLink).not.toHaveBeenCalled();

    fireEvent.change(email, { target: { value: 'olga@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Login-Link senden' }));

    expect(await screen.findByText(/Login-Link an olga@example.com geschickt/)).toBeInTheDocument();
    expect(authClient.signIn.magicLink).toHaveBeenCalledWith({
      email: 'olga@example.com',
      callbackURL: `/p/${PROJECT.id}`,
      errorCallbackURL: `/login?redirect=${encodeURIComponent(`/p/${PROJECT.id}`)}`,
      // The mail is written in the language of the page (spec 32a).
      metadata: { language: 'de' },
    });
    expect(screen.getByRole('link', { name: 'Entwicklungs-Postfach öffnen' })).toBeInTheDocument();
  });

  it('offers the two languages on the login page, and asks for the mail in the one shown', async () => {
    renderApp('/login');
    const languages = within(await screen.findByRole('group', { name: 'Sprache' }));
    expect(screen.getByRole('group', { name: 'Anmeldemethode per E-Mail' })).toBeInTheDocument();
    expect(languages.getByRole('button', { name: 'Deutsch' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(languages.getByRole('button', { name: 'English' }));

    expect(await screen.findByRole('heading', { name: 'Sign in to Covibes' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('en');
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'olga@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send login link' }));
    await waitFor(() => {
      expect(authClient.signIn.magicLink).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { language: 'en' } }),
      );
    });
    // Nobody is signed in: no account to write it to.
    expect(authClient.updateUser).not.toHaveBeenCalled();
  });

  it('tells someone who came through an invitation link that it waits behind the login', async () => {
    const invitation = `/invite/${'T'.repeat(43)}`;
    const router = renderApp(invitation);

    expect(
      await screen.findByText(
        'Du wurdest zu einem Projekt eingeladen. Melde dich an, dann geht es weiter zur Einladung.',
      ),
    ).toBeInTheDocument();
    expect(router.state.location.search).toEqual({ redirect: invitation });
  });

  it('ignores redirect targets outside the app', async () => {
    renderApp('/login?redirect=https%3A%2F%2Fevil.example');

    fireEvent.change(await screen.findByLabelText('E-Mail-Adresse'), {
      target: { value: 'olga@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Login-Link senden' }));
    await waitFor(() => {
      expect(authClient.signIn.magicLink).toHaveBeenCalledWith(
        expect.objectContaining({ callbackURL: '/', errorCallbackURL: '/login' }),
      );
    });
  });

  it('hides the login by mail when the server cannot send mails', async () => {
    stubApi({
      'GET /api/config': () => ({
        body: { gitlabLogin: true, emailLogin: false, devMailbox: false },
      }),
    });
    renderApp('/login');

    const gitlab = await screen.findByRole('button', { name: 'Mit GitLab fortfahren' });
    await waitFor(() => {
      expect(gitlab).toBeEnabled();
    });
    expect(screen.queryByLabelText('E-Mail-Adresse')).not.toBeInTheDocument();
  });

  it('explains an expired or used login link', async () => {
    renderApp('/login?error=INVALID_TOKEN');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'abgelaufen oder wurde schon benutzt',
    );
  });

  it('shows too many attempts as its own message', async () => {
    vi.mocked(authClient.signIn.magicLink).mockResolvedValue({
      data: null,
      error: { status: 429 },
    });
    renderApp('/login');

    fireEvent.change(await screen.findByLabelText('E-Mail-Adresse'), {
      target: { value: 'olga@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Login-Link senden' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Zu viele Versuche');
  });
});

describe('a read-only link', () => {
  const TOKEN = 'S'.repeat(43);
  const SHARED: SharedProject = {
    name: 'Vereins-App',
    boards: [...DETAILS.boards, EXTRA_BOARD],
    decisions: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        topic: 'Datenbank',
        status: 'decided',
        value: 'PostgreSQL',
        reasoning: 'Bewährt und frei.',
        alternatives: [],
        decidedBy: null,
        decidedAt: '2026-10-01T10:00:00.000Z',
        reopenReason: null,
        comparison: null,
        tally: null,
        variants: null,
      },
    ],
    criteria: [{ id: '66666666-6666-4666-8666-666666666666', text: 'Kleines Budget' }],
    customAgents: [],
  };
  const node = (label: string) => ({ label });

  it('shows boards and overview without a session, and nothing to change', async () => {
    signedIn(null);
    const api = stubApi({
      'POST /api/share/view': () => ({ body: SHARED }),
      'POST /api/share/board': (init) => ({
        body: {
          nodes:
            typeof init?.body === 'string' && init.body.includes(EXTRA_BOARD.id)
              ? [node('Start')]
              : [node('API')],
          edges: [],
        },
      }),
    });
    const router = renderApp(`/share/${TOKEN}`);

    expect(await screen.findByRole('heading', { name: 'Vereins-App' })).toBeInTheDocument();
    // No login in between.
    expect(router.state.location.pathname).toBe(`/share/${TOKEN}`);
    expect(screen.getByText('Nur lesen')).toBeInTheDocument();
    // The view needs no account, so it offers the languages itself (spec 32a).
    expect(screen.getByRole('group', { name: 'Sprache' })).toBeInTheDocument();
    expect(await screen.findByTestId('shared-board')).toHaveTextContent('API');

    // The overview: decisions and criteria, without the log and without anything to edit.
    const overview = screen.getByRole('complementary', { name: 'Überblick' });
    expect(overview).toHaveTextContent('DatenbankPostgreSQL');
    expect(overview).toHaveTextContent('Kleines Budget');
    expect(within(overview).queryByRole('button', { name: 'Protokoll' })).not.toBeInTheDocument();
    expect(within(overview).queryByRole('button', { name: /Kriterium/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Teilen' })).not.toBeInTheDocument();

    // A decision opens with its reasoning, and cannot be reopened.
    fireEvent.click(within(overview).getByRole('button', { name: /Datenbank/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Datenbank' });
    expect(dialog).toHaveTextContent('Bewährt und frei.');
    expect(within(dialog).queryByRole('button', { name: /öffnen/ })).not.toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });

    // The other board loads when its tab is opened.
    const tabs = within(screen.getByRole('tablist', { name: 'Boards' })).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Haupt-Canvas', 'Ablauf']);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(tabs[1] as HTMLElement);
    await waitFor(() => {
      expect(screen.getByTestId('shared-board')).toHaveTextContent('Start');
    });
    // The token travels in the body, never in an address of the API.
    expect(api).toHaveBeenCalledWith(
      '/api/share/board',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ token: TOKEN, boardId: EXTRA_BOARD.id }),
      }),
    );
  });

  it('shows the canvas and the overview one at a time on a phone (spec 36e)', async () => {
    onPhone();
    signedIn(null);
    stubApi({
      'POST /api/share/view': () => ({ body: SHARED }),
      'POST /api/share/board': () => ({ body: { nodes: [node('API')], edges: [] } }),
    });
    renderApp(`/share/${TOKEN}`);

    expect(await screen.findByRole('heading', { name: 'Vereins-App' })).toBeInTheDocument();
    expect(await screen.findByTestId('shared-board')).toHaveTextContent('API');
    const areas = screen.getByRole('navigation', { name: 'Bereiche' });
    expect(within(areas).getByRole('button', { name: 'Canvas' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // The overview waits behind its tab, with the language switch.
    expect(screen.queryByRole('complementary', { name: 'Überblick' })).not.toBeInTheDocument();

    fireEvent.click(within(areas).getByRole('button', { name: 'Überblick' }));

    const overview = screen.getByRole('complementary', { name: 'Überblick' });
    expect(overview).toHaveTextContent('DatenbankPostgreSQL');
    expect(within(overview).getByRole('group', { name: 'Sprache' })).toBeInTheDocument();
    expect(screen.queryByTestId('shared-board')).not.toBeInTheDocument();
  });

  it('says so when the link shows nothing any more', async () => {
    signedIn(null);
    stubApi({});
    renderApp(`/share/${TOKEN}`);

    expect(
      await screen.findByRole('heading', { name: 'Dieser Link zeigt nichts mehr' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/abgeschaltet oder ersetzt/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zu Covibes' })).toHaveAttribute('href', '/');
  });
});

describe('with a session', () => {
  beforeEach(() => {
    signedIn(OLGA);
  });

  it('leaves the login page for the requested page', async () => {
    stubApi({ 'GET /api/projects': () => ({ body: [] }) });
    const router = renderApp('/login?redirect=%2F');

    expect(await screen.findByRole('heading', { name: 'Deine Projekte' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('welcomes someone without a project: what Covibes is, three steps and the first project (spec 33)', async () => {
    stubApi({ 'GET /api/projects': () => ({ body: [] }) });
    renderApp('/');

    expect(
      await screen.findByRole('heading', { name: 'Willkommen bei Covibes' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/bevor der erste Code entsteht/)).toBeInTheDocument();
    expect(
      screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent),
    ).toEqual(['Sammeln', 'Entscheiden', 'Übergeben']);

    // The button of the welcome opens the same dialog as the one of the page.
    fireEvent.click(screen.getByRole('button', { name: 'Erstes Projekt anlegen' }));
    expect(await screen.findByRole('dialog', { name: 'Neues Projekt' })).toBeInTheDocument();
  });

  it('opens workspace AI settings from the project list', async () => {
    stubApi({
      'GET /api/projects': () => ({ body: [] }),
      'GET /api/workspaces': () => ({
        body: [{ id: 'own', name: 'Mein Team', kind: 'team', role: 'owner' }],
      }),
      'GET /api/workspaces/own/ai': () => ({
        body: {
          configured: [],
          canStoreKeys: true,
          month: '2026-11',
          spending: { workspaceUsd: 0, instanceUsd: 0 },
        },
      }),
    });
    renderApp('/');

    fireEvent.click(await screen.findByRole('button', { name: 'KI-Einstellungen' }));
    const dialog = await screen.findByRole('dialog', { name: 'KI-Einstellungen' });
    expect(await within(dialog).findByLabelText('Anthropic')).toBeInTheDocument();
    expect(within(dialog).getByRole('option', { name: 'Mein Team' })).toBeInTheDocument();
  });

  it('keeps the welcome for those without a project', async () => {
    stubApi({ 'GET /api/projects': () => ({ body: [PROJECT] }) });
    renderApp('/');

    expect(await screen.findByRole('list', { name: 'Projekte' })).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Willkommen bei Covibes' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Erstes Projekt anlegen' }),
    ).not.toBeInTheDocument();
  });

  it('lists projects with role and last change', async () => {
    stubApi({ 'GET /api/projects': () => ({ body: [PROJECT] }) });
    renderApp('/');

    const link = await screen.findByRole('link', { name: /Covibes V1/ });
    expect(link).toHaveAttribute('href', `/p/${PROJECT.id}`);
    expect(link).toHaveTextContent('Owner · geändert jetzt');
  });

  it('shows on the project list how much waits in a project (spec 22a)', async () => {
    stubApi({
      'GET /api/projects': () => ({
        body: [
          { ...PROJECT, waiting: 3 },
          { ...PROJECT, id: '77777777-7777-4777-8777-777777777777', name: 'Ruhig', waiting: 0 },
          { ...PROJECT, id: '88888888-8888-4888-8888-888888888888', name: 'Eins', waiting: 1 },
        ],
      }),
    });
    renderApp('/');

    const rows = within(await screen.findByRole('list', { name: 'Projekte' })).getAllByRole(
      'listitem',
    );
    expect(rows[0]).toHaveTextContent('3 warten auf dich');
    expect(rows[1]).not.toHaveTextContent(/wartet|warten/);
    expect(rows[2]).toHaveTextContent('1 wartet auf dich');
  });

  it('shows the phase, the people and the team on a project card (spec 36c)', async () => {
    const custom = '99999999-9999-4999-8999-999999999999';
    stubApi({
      'GET /api/projects': () => ({
        body: [
          {
            ...PROJECT,
            phase: 'architecture',
            members: [
              { userId: OLGA.id, name: 'Olga' },
              { userId: '22222222-2222-4222-8222-222222222222', name: 'Sam Beispiel' },
              ...['Ana', 'Ben', 'Cem', 'Dora'].map((name, index) => ({
                userId: `3333333${String(index)}-3333-4333-8333-333333333333`,
                name,
              })),
            ],
            agents: [
              { key: 'moderator', custom: null },
              { key: 'critic', custom: null },
              { key: custom, custom: { name: 'UX Writer', color: 3, mark: 'leaf' } },
            ],
          },
        ],
      }),
    });
    renderApp('/');

    const card = await screen.findByRole('link', { name: /Covibes V1/ });
    expect(card).toHaveTextContent('ArchitekturSchritt 3 von 4');
    const people = within(card).getByRole('group', { name: 'Menschen im Projekt' });
    expect(
      within(people)
        .getAllByRole('img')
        .map((img) => img.getAttribute('aria-label')),
    ).toEqual(['Du', 'Sam Beispiel', 'Ana', 'Ben', '2 weitere']);
    const team = within(card).getByRole('group', { name: 'Agents im Team' });
    expect(
      within(team)
        .getAllByRole('img')
        .map((img) => img.getAttribute('aria-label')),
    ).toEqual(['Moderator', 'Kritiker', 'UX Writer']);
    expect(within(team).getByRole('img', { name: 'UX Writer' })).toHaveClass('agent-color-3');
    expect(
      within(team).getByRole('img', { name: 'UX Writer' }).querySelector('path'),
    ).toHaveAttribute('d', CUSTOM_MARKS.leaf);
  });

  it('greets by the time of day and filters the projects by name (spec 36c)', async () => {
    stubApi({
      'GET /api/projects': () => ({
        body: [
          PROJECT,
          { ...PROJECT, id: '77777777-7777-4777-8777-777777777777', name: 'Vereins-App' },
        ],
      }),
    });
    renderApp('/');

    expect(await screen.findByText(/^(Guten Morgen|Hallo|Guten Abend), Olga$/)).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: 'Projekte' });
    // Two projects and the card for a new one.
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Projekte durchsuchen' }), {
      target: { value: 'verein' },
    });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    expect(list).toHaveTextContent('Vereins-App');

    fireEvent.change(screen.getByRole('searchbox', { name: 'Projekte durchsuchen' }), {
      target: { value: 'nichts' },
    });
    expect(screen.getByText('Kein Projekt heißt so.')).toBeInTheDocument();
  });

  it('opens "Neues Projekt" from the last card (spec 36c)', async () => {
    stubApi({ 'GET /api/projects': () => ({ body: [PROJECT] }) });
    renderApp('/');

    fireEvent.click(await screen.findByRole('button', { name: /^Neues Projekt/ }));
    expect(await screen.findByRole('dialog', { name: 'Neues Projekt' })).toBeInTheDocument();
  });

  it('creates a project and opens it', async () => {
    const api = stubApi({
      'GET /api/projects': () => ({ body: [] }),
      'POST /api/projects': () => ({ status: 201, body: PROJECT }),
      [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }),
    });
    const router = renderApp('/');

    fireEvent.click(await screen.findByRole('button', { name: 'Projekt anlegen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Neues Projekt' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('1 bis 120 Zeichen');

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Covibes V1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Anlegen' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/p/${PROJECT.id}`);
    });
    const post = api.mock.calls.find(([, init]) => init?.method === 'POST');
    // The project is written in the language of the interface unless the person says otherwise.
    expect(post?.[1]?.body).toBe(JSON.stringify({ name: 'Covibes V1', language: 'de' }));
  });

  it('asks in which language the project is written, and proposes the one of the interface (spec 32b)', async () => {
    signedIn({ ...OLGA, locale: 'en' });
    const api = stubApi({
      'GET /api/projects': () => ({ body: [] }),
      'POST /api/projects': () => ({ status: 201, body: PROJECT }),
      [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }),
    });
    renderApp('/');

    fireEvent.click(await screen.findByRole('button', { name: 'Create project' }));
    const dialog = await screen.findByRole('dialog', { name: 'New project' });
    const languages = within(
      within(dialog).getByRole('group', { name: 'Language of the project' }),
    );
    // The account is English, so is the proposal.
    expect(languages.getByRole('radio', { name: 'English' })).toBeChecked();
    expect(languages.getByRole('radio', { name: 'Deutsch' })).not.toBeChecked();
    expect(languages.getByRole('radio', { name: 'Deutsch' })).toHaveAccessibleDescription(
      /written in this language/,
    );

    fireEvent.click(languages.getByRole('radio', { name: 'Deutsch' }));
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Vereins-App' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() => {
      const post = api.mock.calls.find(([, init]) => init?.method === 'POST');
      expect(post?.[1]?.body).toBe(JSON.stringify({ name: 'Vereins-App', language: 'de' }));
    });
  });

  it('opens the workspace with the real members, the own one as "Du"', async () => {
    stubApi({ [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }) });
    renderApp(`/p/${PROJECT.id}`);

    expect(await screen.findByRole('button', { name: /Covibes V1/ })).toBeInTheDocument();
    const humans = screen.getByRole('group', { name: 'Menschen' });
    const avatars = within(humans).getAllByRole('img');
    expect(avatars.map((avatar) => avatar.getAttribute('aria-label'))).toEqual(['Du', 'Alex Berg']);
    expect(within(humans).getByText('AB')).toBeInTheDocument();
    const canvas = await screen.findByTestId('canvas-panel');
    expect(canvas).toHaveAttribute('data-board', DETAILS.boards[0]?.id);
    expect(canvas).toHaveAttribute('data-readonly', 'false');
    const chat = screen.getByTestId('chat-panel');
    expect(chat).toHaveAttribute('data-project', PROJECT.id);
    expect(chat).toHaveAttribute('data-readonly', 'false');
  });

  it('shows what happened while the user was away, opens it and closes for good (spec 23)', async () => {
    let closed = false;
    const api = stubApi({
      [`GET /api/projects/${PROJECT.id}`]: () => ({
        body: { ...DETAILS, boards: [...DETAILS.boards, EXTRA_BOARD] },
      }),
      [`GET /api/projects/${PROJECT.id}/decisions`]: () => ({ body: [CANVAS_DECISION] }),
      [`GET /api/projects/${PROJECT.id}/away`]: () => ({ body: closed ? null : AWAY }),
      [`POST /api/projects/${PROJECT.id}/away/dismiss`]: () => {
        closed = true;
        return { status: 204, body: null };
      },
    });
    const router = renderApp(`/p/${PROJECT.id}`);

    const section = await screen.findByRole('region', { name: 'Seit du weg warst' });
    expect(section).toHaveTextContent('zuletzt hier gestern');
    expect(section).toHaveTextContent('Alex hat React Flow vorgeschlagen');
    expect(section).toHaveTextContent('6 neue Nachrichten von Alex Berg');
    // It comes first in the overview, above the decisions.
    const decisions = await screen.findByRole('region', { name: 'Entscheidungen' });
    expect(
      section.compareDocumentPosition(decisions) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The decision opens with its reasoning, where it can be reopened.
    await within(decisions).findByText('React Flow');
    fireEvent.click(within(section).getByRole('button', { name: /Entschieden: Canvas/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Canvas' });
    expect(dialog).toHaveTextContent('Strukturierte Blöcke und MIT-Lizenz.');
    expect(within(dialog).getByRole('button', { name: 'Wieder öffnen' })).toBeInTheDocument();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    // The new board opens from its line.
    fireEvent.click(within(section).getByRole('button', { name: /Neues Board: Ablauf/ }));
    await waitFor(() => {
      expect(router.state.location.search).toEqual({ board: EXTRA_BOARD.id });
    });

    fireEvent.click(within(section).getByRole('button', { name: 'Verstanden' }));
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'Seit du weg warst' })).not.toBeInTheDocument();
    });
    expect(api).toHaveBeenCalledWith(
      `/api/projects/${PROJECT.id}/away/dismiss`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('asks for the summary again when the server says the user is back (spec 23)', async () => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    let asked = 0;
    const api = stubApi({
      [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }),
      [`POST /api/projects/${PROJECT.id}/seen`]: () => ({ body: { returned: true } }),
      // The absence is noted with the report; only the question after it finds the summary.
      [`GET /api/projects/${PROJECT.id}/away`]: () => {
        asked += 1;
        return { body: asked > 1 ? AWAY : null };
      },
    });
    renderApp(`/p/${PROJECT.id}`);

    expect(await screen.findByRole('region', { name: 'Seit du weg warst' })).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith(
      `/api/projects/${PROJECT.id}/seen`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('opens the project settings from the project menu, where owners change them', async () => {
    const api = stubApi({
      [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }),
      [`PATCH /api/projects/${PROJECT.id}`]: () => ({ status: 204, body: null }),
    });
    const router = renderApp(`/p/${PROJECT.id}`);
    const patched = (body: unknown) =>
      waitFor(() => {
        expect(api).toHaveBeenCalledWith(
          `/api/projects/${PROJECT.id}`,
          expect.objectContaining({ method: 'PATCH', body: JSON.stringify(body) }),
        );
      });

    const menu = await screen.findByRole('button', { name: /Covibes V1/ });
    fireEvent.keyDown(menu, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Einstellungen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Projekteinstellungen' });

    expect(
      within(dialog).getByRole('radio', { name: /Neutral nach euren Kriterien/ }),
    ).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: /Konsens mit Bestätigung/ })).toBeChecked();
    fireEvent.click(within(dialog).getByRole('radio', { name: /Strikt neutral/ }));
    await patched({ stance: 'strict' });
    fireEvent.click(within(dialog).getByRole('radio', { name: /Abstimmung/ }));
    await patched({ decisionProcess: 'vote' });

    const proposalsOnly = within(dialog).getByRole('checkbox', { name: /Nur Vorschläge/ });
    expect(proposalsOnly).not.toBeChecked();
    fireEvent.click(proposalsOnly);
    await patched({ proposalsOnly: true });
    const observer = within(dialog).getByRole('checkbox', { name: /Agents melden sich/ });
    expect(observer).toBeChecked();
    fireEvent.click(observer);
    await patched({ observer: false });
    const webAccess = within(dialog).getByRole('checkbox', { name: /Web-Zugriff/ });
    expect(webAccess).toBeChecked();
    expect(webAccess).toHaveAccessibleDescription('Agents dürfen im Web suchen und Links lesen.');
    fireEvent.click(webAccess);
    await patched({ webAccess: false });
    // The language the project is written in (spec 32b).
    const languages = within(within(dialog).getByRole('group', { name: 'Sprache des Projekts' }));
    expect(languages.getByRole('radio', { name: /Deutsch/ })).toBeChecked();
    fireEvent.click(languages.getByRole('radio', { name: /English/ }));
    await patched({ language: 'en' });
    expect(within(dialog).getByText(/Was schon geschrieben ist, bleibt/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));
    fireEvent.keyDown(menu, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Zur Projektliste' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
  });

  it('offers owners the usage in the project menu, and nobody else (spec 31b)', async () => {
    const api = stubApi({
      [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }),
      [`GET /api/projects/${PROJECT.id}/usage`]: () => ({
        body: {
          month: '2026-10',
          current: true,
          limits: { projectMonthUsd: 100, userDayUsd: 15 },
          endsAt: '2026-11-01T00:00:00.000Z',
          total: { costUsd: 6.17, runs: 42, inputTokens: 1000, outputTokens: 200 },
          byAgent: [],
          bySource: [],
          byDay: [],
        },
      }),
    });
    renderApp(`/p/${PROJECT.id}`);
    const asked = () =>
      api.mock.calls.some(
        ([input]) =>
          (input instanceof Request ? input.url : input.toString()) ===
          `/api/projects/${PROJECT.id}/usage`,
      );

    fireEvent.keyDown(await screen.findByRole('button', { name: /Covibes V1/ }), { key: 'Enter' });
    const entry = await screen.findByRole('menuitem', { name: 'Verbrauch …' });
    // Loaded only once the dialog opens.
    expect(asked()).toBe(false);
    fireEvent.click(entry);

    const dialog = await screen.findByRole('dialog', { name: 'Verbrauch' });
    expect(await within(dialog).findByRole('region', { name: 'Gesamt' })).toHaveTextContent(
      '6,17 $',
    );
    expect(asked()).toBe(true);
  });

  it.each(['editor', 'viewer'] as const)('keeps the usage from the menu of a %s', async (role) => {
    stubApi({ [`GET /api/projects/${PROJECT.id}`]: () => ({ body: { ...DETAILS, role } }) });
    renderApp(`/p/${PROJECT.id}`);

    fireEvent.keyDown(await screen.findByRole('button', { name: /Covibes V1/ }), { key: 'Enter' });

    expect(await screen.findByRole('menuitem', { name: 'Einstellungen' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Verbrauch …' })).not.toBeInTheDocument();
  });

  it('shows editors the project settings without letting them change anything', async () => {
    stubApi({
      [`GET /api/projects/${PROJECT.id}`]: () => ({
        body: {
          ...DETAILS,
          role: 'editor',
          proposalsOnly: true,
          decisionProcess: 'owner',
          language: 'en',
        },
      }),
    });
    renderApp(`/p/${PROJECT.id}`);

    fireEvent.keyDown(await screen.findByRole('button', { name: /Covibes V1/ }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Einstellungen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Projekteinstellungen' });

    expect(dialog).toHaveTextContent('Nur Owner ändern die Einstellungen.');
    expect(within(dialog).getByRole('radio', { name: /Owner entscheidet/ })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /Nur Vorschläge/ })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: /English/ })).toBeChecked();
    for (const control of [
      ...within(dialog).getAllByRole('radio'),
      ...within(dialog).getAllByRole('checkbox'),
    ]) {
      expect(control).toBeDisabled();
    }
  });

  it('opens canvas and chat read-only for viewers', async () => {
    stubApi({
      [`GET /api/projects/${PROJECT.id}`]: () => ({ body: { ...DETAILS, role: 'viewer' } }),
    });
    renderApp(`/p/${PROJECT.id}`);

    expect(await screen.findByTestId('canvas-panel')).toHaveAttribute('data-readonly', 'true');
    expect(screen.getByTestId('chat-panel')).toHaveAttribute('data-readonly', 'true');
  });

  describe('on a phone (spec 36e)', () => {
    beforeEach(onPhone);

    it('shows one area at a time under a compact header, the canvas for reading', async () => {
      stubApi({
        [`GET /api/projects/${PROJECT.id}`]: () => ({
          body: { ...DETAILS, boards: [...DETAILS.boards, EXTRA_BOARD] },
        }),
      });
      renderApp(`/p/${PROJECT.id}`);

      expect(await screen.findByRole('heading', { name: 'Covibes V1' })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Zur Projektliste' })).toHaveAttribute('href', '/');
      expect(screen.getByText('Architektur · Schritt 3 von 4')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: 'Team: Moderator' })).toBeInTheDocument();
      // The desktop's top bar is not there.
      expect(screen.queryByRole('button', { name: 'Teilen' })).not.toBeInTheDocument();

      const areas = screen.getByRole('navigation', { name: 'Bereiche' });
      expect(within(areas).getByRole('button', { name: 'Chat' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(screen.getByTestId('chat-panel')).toBeVisible();
      expect(screen.queryByTestId('canvas-panel')).not.toBeInTheDocument();

      fireEvent.click(within(areas).getByRole('button', { name: 'Canvas' }));

      // Nothing on the canvas changes on a phone; the chat stays, out of sight.
      expect(screen.getByTestId('canvas-panel')).toHaveAttribute('data-readonly', 'true');
      expect(screen.getByTestId('chat-panel')).not.toBeVisible();

      fireEvent.click(within(areas).getByRole('button', { name: 'Chat' }));
      expect(screen.queryByTestId('canvas-panel')).not.toBeInTheDocument();

      // A reference in the chat brings the canvas up at its element.
      fireEvent.click(
        within(screen.getByTestId('chat-panel')).getByRole('button', { name: 'Verweis Ablauf' }),
      );
      await waitFor(() => {
        expect(screen.getByTestId('canvas-panel')).toHaveAttribute(
          'data-focus',
          REFERENCES.Ablauf.nodeId,
        );
      });
      expect(within(areas).getByRole('button', { name: 'Canvas' })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });

    it('counts what waits on the overview tab', async () => {
      stubApi({
        [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }),
        [`GET /api/projects/${PROJECT.id}/hands`]: () => ({
          body: [
            {
              id: '77777777-7777-4777-8777-777777777777',
              projectId: PROJECT.id,
              agentKey: 'moderator',
              reason: 'Das Hosting ist noch offen.',
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      });
      renderApp(`/p/${PROJECT.id}`);

      const tab = await screen.findByRole('button', { name: 'Überblick, 1 wartet auf dich' });
      expect(screen.queryByRole('complementary', { name: 'Überblick' })).not.toBeInTheDocument();

      fireEvent.click(tab);

      const overview = screen.getByRole('complementary', { name: 'Überblick' });
      expect(overview).toBeVisible();
      expect(overview).toHaveTextContent('Das Hosting ist noch offen.');
    });

    it('starts on the canvas when the address names the plan, and opens it read-only', async () => {
      stubApi({ [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }) });
      renderApp(`/p/${PROJECT.id}?view=plan`);

      expect(await screen.findByTestId('plan-panel')).toHaveAttribute('data-readonly', 'true');
      expect(screen.queryByRole('button', { name: 'Plan erzeugen' })).not.toBeInTheDocument();
    });
  });

  it('shows the phase of the project and jumps to another one from its card (spec 24)', async () => {
    let phase: ProjectDetails['phase'] = 'decide';
    const api = stubApi({
      [`GET /api/projects/${PROJECT.id}`]: () => ({ body: { ...DETAILS, phase } }),
      [`PUT /api/projects/${PROJECT.id}/phase`]: (init) => {
        ({ phase } = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
          phase: ProjectDetails['phase'];
        });
        return { status: 204, body: null };
      },
    });
    renderApp(`/p/${PROJECT.id}`);

    const phases = await screen.findByRole('navigation', { name: 'Phasen' });
    expect(phases.querySelector('[aria-current="step"]')).toHaveAccessibleName(/^Entscheiden/);

    fireEvent.click(within(phases).getByRole('button', { name: /Architektur/ }));
    const card = await screen.findByRole('dialog', { name: 'Architektur' });
    fireEvent.click(within(card).getByRole('button', { name: 'Zu dieser Phase wechseln' }));

    await waitFor(() => {
      expect(phases.querySelector('[aria-current="step"]')).toHaveAccessibleName(/^Architektur/);
    });
    expect(api).toHaveBeenCalledWith(
      `/api/projects/${PROJECT.id}/phase`,
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ phase: 'architecture' }) }),
    );
    // The note follows the change a moment later.
    await waitFor(() => {
      expect(screen.getByTestId('canvas-panel')).toHaveTextContent(
        'Das Projekt ist jetzt in der Phase „Architektur“.',
      );
    });
  });

  it('takes the phase back with a note when the server refuses the change', async () => {
    stubApi({
      [`GET /api/projects/${PROJECT.id}`]: () => ({ body: { ...DETAILS, phase: 'decide' } }),
      [`PUT /api/projects/${PROJECT.id}/phase`]: () => ({
        status: 403,
        body: { error: { code: 'forbidden', message: 'No.' } },
      }),
    });
    renderApp(`/p/${PROJECT.id}`);
    const phases = await screen.findByRole('navigation', { name: 'Phasen' });

    fireEvent.click(within(phases).getByRole('button', { name: /Projektplan/ }));
    const card = await screen.findByRole('dialog', { name: 'Projektplan' });
    fireEvent.click(within(card).getByRole('button', { name: 'Zu dieser Phase wechseln' }));

    await waitFor(() => {
      expect(screen.getByTestId('canvas-panel')).toHaveTextContent(
        'Die Phase konnte nicht gewechselt werden.',
      );
    });
    expect(phases.querySelector('[aria-current="step"]')).toHaveAccessibleName(/^Entscheiden/);
  });

  it('tells everyone when someone else or the moderator changes the phase', async () => {
    let phase: ProjectDetails['phase'] = 'brainstorming';
    stubApi({ [`GET /api/projects/${PROJECT.id}`]: () => ({ body: { ...DETAILS, phase } }) });
    renderApp(`/p/${PROJECT.id}`);
    const phases = await screen.findByRole('navigation', { name: 'Phasen' });
    expect(phases.querySelector('[aria-current="step"]')).toHaveAccessibleName(/^Brainstorming/);
    // Opening a project is no change of its phase.
    expect(screen.getByTestId('canvas-panel')).not.toHaveTextContent('Phase');

    phase = 'decide';
    act(() => {
      live.handlers?.onEvent({ type: 'project' });
    });

    await waitFor(() => {
      expect(phases.querySelector('[aria-current="step"]')).toHaveAccessibleName(/^Entscheiden/);
    });
    expect(screen.getByTestId('canvas-panel')).toHaveTextContent(
      'Das Projekt ist jetzt in der Phase „Entscheiden“.',
    );
  });

  it('asks the moderator for the next step from the current phase', async () => {
    const api = stubApi({
      [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }),
      [`POST /api/projects/${PROJECT.id}/messages`]: (init) => ({
        status: 201,
        body: {
          ...(JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as object),
          projectId: PROJECT.id,
          author: { kind: 'human', userId: OLGA.id, name: OLGA.name },
          mentions: ['moderator'],
          replyTo: null,
          status: 'complete',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
    });
    renderApp(`/p/${PROJECT.id}`);
    const phases = await screen.findByRole('navigation', { name: 'Phasen' });

    fireEvent.click(within(phases).getByRole('button', { name: /Architektur/ }));
    const card = await screen.findByRole('dialog', { name: 'Architektur' });
    fireEvent.click(within(card).getByRole('button', { name: 'Moderator fragen' }));

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith(
        `/api/projects/${PROJECT.id}/messages`,
        expect.objectContaining({ method: 'POST' }),
      );
    });
    const sent = api.mock.calls.find(
      ([url, init]) =>
        typeof url === 'string' && url.endsWith('/messages') && init?.method === 'POST',
    )?.[1]?.body;
    expect(JSON.parse(typeof sent === 'string' ? sent : '{}')).toMatchObject({
      content: '@Moderator Wo stehen wir, und was ist der nächste Schritt?',
    });
  });

  it('lets viewers read what the phases are for, without changing or asking', async () => {
    stubApi({
      [`GET /api/projects/${PROJECT.id}`]: () => ({ body: { ...DETAILS, role: 'viewer' } }),
    });
    renderApp(`/p/${PROJECT.id}`);
    const phases = await screen.findByRole('navigation', { name: 'Phasen' });

    fireEvent.click(within(phases).getByRole('button', { name: /Projektplan/ }));
    const card = await screen.findByRole('dialog', { name: 'Projektplan' });
    expect(card).toHaveTextContent('Aus dem Ergebnis den Projektplan machen');
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('opens the project plan named in the address, in place of the canvas (spec 25a)', async () => {
    stubApi({ [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }) });
    const router = renderApp(`/p/${PROJECT.id}?view=plan`);

    const plan = await screen.findByTestId('plan-panel');
    expect(plan).toHaveAttribute('data-project', PROJECT.id);
    expect(plan).toHaveAttribute('data-readonly', 'false');
    expect(plan).toHaveAttribute('data-language', 'de');
    expect(screen.queryByTestId('canvas-panel')).not.toBeInTheDocument();
    expect(within(plan).getByRole('button', { name: 'Projektplan' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Chat and overview stay next to it.
    expect(screen.getByTestId('chat-panel')).toBeInTheDocument();

    // A board tab brings the canvas back, and the address follows.
    fireEvent.click(within(plan).getByRole('tab', { name: 'Haupt-Canvas' }));
    expect(await screen.findByTestId('canvas-panel')).toHaveAttribute(
      'data-board',
      DETAILS.boards[0]?.id,
    );
    expect(screen.queryByTestId('plan-panel')).not.toBeInTheDocument();
    expect(router.state.location.search).toEqual({});
  });

  it('opens the plan read-only for viewers', async () => {
    stubApi({
      [`GET /api/projects/${PROJECT.id}`]: () => ({
        body: { ...DETAILS, role: 'viewer', language: 'en' },
      }),
    });
    renderApp(`/p/${PROJECT.id}?view=plan`);

    const plan = await screen.findByTestId('plan-panel');
    expect(plan).toHaveAttribute('data-readonly', 'true');
    expect(plan).toHaveAttribute('data-language', 'en');
  });

  describe('generating the plan (spec 25b)', () => {
    const PLAN_URL = `/api/projects/${PROJECT.id}/plan`;
    const QUIET: PlanState = {
      suggestions: [],
      generating: false,
      failure: null,
      outdated: null,
      upToDate: false,
    };
    const suggestions = (count: number): PlanState['suggestions'] =>
      (['scope', 'milestones', 'tech'] as const).slice(0, count).map((section, index) => ({
        id: `7777777${String(index)}-7777-4777-8777-777777777777`,
        section,
        content: [],
        createdAt: new Date().toISOString(),
        kind: 'generate',
        handEdited: false,
      }));

    it('starts a generation, shows what arrives and accepts it', async () => {
      let state = QUIET;
      const api = stubApi({
        [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }),
        [`GET ${PLAN_URL}`]: () => ({ body: state }),
        [`POST ${PLAN_URL}/generate`]: () => {
          state = { ...QUIET, generating: true };
          return { status: 202, body: null };
        },
        [`POST ${PLAN_URL}/suggestions/accept`]: () => {
          state = QUIET;
          return { status: 204, body: null };
        },
      });
      renderApp(`/p/${PROJECT.id}?view=plan`);
      const plan = await screen.findByTestId('plan-panel');
      await waitFor(() => {
        expect(plan).toHaveAttribute('data-generating', 'false');
      });

      fireEvent.click(within(plan).getByRole('button', { name: 'Plan erzeugen' }));
      // The plan says at once that the moderator writes.
      await waitFor(() => {
        expect(plan).toHaveAttribute('data-generating', 'true');
      });
      expect(api).toHaveBeenCalledWith(
        `${PLAN_URL}/generate`,
        expect.objectContaining({ method: 'POST' }),
      );

      // The worker is done: its suggestions arrive with the live channel.
      state = { ...QUIET, suggestions: suggestions(3) };
      act(() => {
        live.handlers?.onEvent({ type: 'plan' });
      });
      await waitFor(() => {
        expect(plan).toHaveAttribute('data-suggestions', '3');
      });
      expect(plan).toHaveAttribute('data-generating', 'false');
      // They wait for the user, who is looking at the plan already.
      const waiting = screen.getByRole('region', { name: 'Wartet auf dich' });
      expect(waiting).toHaveTextContent('3 Abschnitte für den Projektplan warten auf dich.');
      expect(within(waiting).queryByRole('button', { name: 'Plan öffnen' })).toBeNull();

      fireEvent.click(within(plan).getByRole('button', { name: 'Alle übernehmen' }));
      await waitFor(() => {
        expect(plan).toHaveAttribute('data-suggestions', '0');
      });
      expect(api).toHaveBeenCalledWith(
        `${PLAN_URL}/suggestions/accept`,
        expect.objectContaining({ method: 'POST' }),
      );
      await waitFor(() => {
        expect(screen.queryByRole('region', { name: 'Wartet auf dich' })).not.toBeInTheDocument();
      });
    });

    it('opens the plan from "Wartet auf dich" while the canvas is open', async () => {
      stubApi({
        [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }),
        [`GET ${PLAN_URL}`]: () => ({ body: { ...QUIET, suggestions: suggestions(2) } }),
      });
      const router = renderApp(`/p/${PROJECT.id}`);

      const waiting = await screen.findByRole('region', { name: 'Wartet auf dich' });
      expect(within(waiting).getByLabelText('2 offen')).toBeInTheDocument();
      fireEvent.click(within(waiting).getByRole('button', { name: 'Plan öffnen' }));

      expect(await screen.findByTestId('plan-panel')).toHaveAttribute('data-suggestions', '2');
      expect(router.state.location.search).toEqual({ view: 'plan' });
    });

    it('says so when starting did not work, and shows the state of the server again', async () => {
      stubApi({
        [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }),
        [`GET ${PLAN_URL}`]: () => ({ body: QUIET }),
        [`POST ${PLAN_URL}/generate`]: () => ({
          status: 409,
          body: { error: { code: 'already_running', message: 'Running.' } },
        }),
      });
      renderApp(`/p/${PROJECT.id}?view=plan`);
      const plan = await screen.findByTestId('plan-panel');
      await waitFor(() => {
        expect(plan).toHaveAttribute('data-generating', 'false');
      });

      fireEvent.click(within(plan).getByRole('button', { name: 'Plan erzeugen' }));

      await waitFor(() => {
        expect(plan).toHaveTextContent('Das hat nicht geklappt. Bitte versuche es noch einmal.');
      });
      await waitFor(() => {
        expect(plan).toHaveAttribute('data-generating', 'false');
      });
    });

    it('marks an outdated plan on its button and brings it up to date (spec 25c)', async () => {
      let state: PlanState = {
        ...QUIET,
        outdated: { changes: [{ kind: 'reopened', topic: 'Hosting' }], more: 0 },
      };
      const api = stubApi({
        [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }),
        [`GET ${PLAN_URL}`]: () => ({ body: state }),
        [`POST ${PLAN_URL}/update`]: () => {
          state = { ...QUIET, generating: true };
          return { status: 202, body: null };
        },
      });
      renderApp(`/p/${PROJECT.id}?view=plan`);
      const plan = await screen.findByTestId('plan-panel');
      await waitFor(() => {
        expect(plan).toHaveAttribute('data-outdated', 'true');
      });
      expect(
        within(plan).getByRole('button', { name: 'Projektplan, nicht mehr aktuell' }),
      ).toBeInTheDocument();

      fireEvent.click(within(plan).getByRole('button', { name: 'Aktualisieren' }));

      await waitFor(() => {
        expect(plan).toHaveAttribute('data-generating', 'true');
      });
      expect(api).toHaveBeenCalledWith(
        `${PLAN_URL}/update`,
        expect.objectContaining({ method: 'POST' }),
      );
      // While the moderator writes, the dot rests; the update's suggestions follow.
      state = { ...QUIET, suggestions: suggestions(1) };
      act(() => {
        live.handlers?.onEvent({ type: 'plan' });
      });
      await waitFor(() => {
        expect(plan).toHaveAttribute('data-suggestions', '1');
      });
      expect(within(plan).getByRole('button', { name: 'Projektplan' })).toBeInTheDocument();
    });

    it('shows viewers the suggestions without letting them start or decide anything', async () => {
      stubApi({
        [`GET /api/projects/${PROJECT.id}`]: () => ({ body: { ...DETAILS, role: 'viewer' } }),
        [`GET ${PLAN_URL}`]: () => ({ body: { ...QUIET, suggestions: suggestions(2) } }),
      });
      renderApp(`/p/${PROJECT.id}?view=plan`);

      const plan = await screen.findByTestId('plan-panel');
      await waitFor(() => {
        expect(plan).toHaveAttribute('data-suggestions', '2');
      });
      expect(within(plan).queryByRole('button', { name: 'Plan erzeugen' })).toBeNull();
      expect(within(plan).queryByRole('button', { name: 'Alle übernehmen' })).toBeNull();
      expect(within(plan).queryByRole('button', { name: 'Aktualisieren' })).toBeNull();
      // Nothing waits for someone who only reads.
      expect(screen.queryByRole('region', { name: 'Wartet auf dich' })).not.toBeInTheDocument();
    });
  });

  describe('references from the chat to the canvas (spec 37a)', () => {
    const withBoards = () =>
      stubApi({
        [`GET /api/projects/${PROJECT.id}`]: () => ({
          body: { ...DETAILS, boards: [...DETAILS.boards, EXTRA_BOARD] },
        }),
      });

    it('opens the board of the element and brings the element into view', async () => {
      withBoards();
      const router = renderApp(`/p/${PROJECT.id}`);
      const chat = await screen.findByTestId('chat-panel');

      fireEvent.click(within(chat).getByRole('button', { name: 'Verweis Ablauf' }));

      await waitFor(() => {
        expect(screen.getByTestId('canvas-panel')).toHaveAttribute('data-board', EXTRA_BOARD.id);
      });
      expect(screen.getByTestId('canvas-panel')).toHaveAttribute(
        'data-focus',
        REFERENCES.Ablauf.nodeId,
      );
      expect(router.state.location.search).toEqual({
        board: EXTRA_BOARD.id,
        focus: REFERENCES.Ablauf.nodeId,
      });

      // An element of the main canvas needs no board in the address.
      fireEvent.click(within(chat).getByRole('button', { name: 'Verweis Haupt' }));
      await waitFor(() => {
        expect(router.state.location.search).toEqual({ focus: REFERENCES.Haupt.nodeId });
      });
      expect(screen.getByTestId('canvas-panel')).toHaveAttribute(
        'data-board',
        DETAILS.boards[0]?.id ?? '',
      );
    });

    it('leaves the plan for the canvas when a reference is followed', async () => {
      withBoards();
      const router = renderApp(`/p/${PROJECT.id}?view=plan`);
      await screen.findByTestId('plan-panel');

      fireEvent.click(
        within(screen.getByTestId('chat-panel')).getByRole('button', { name: 'Verweis Haupt' }),
      );

      expect(await screen.findByTestId('canvas-panel')).toHaveAttribute(
        'data-focus',
        REFERENCES.Haupt.nodeId,
      );
      expect(screen.queryByTestId('plan-panel')).not.toBeInTheDocument();
      expect(router.state.location.search).toEqual({ focus: REFERENCES.Haupt.nodeId });
    });

    it('says that an element is gone, and forgets it', async () => {
      withBoards();
      const router = renderApp(`/p/${PROJECT.id}`);
      fireEvent.click(
        within(await screen.findByTestId('chat-panel')).getByRole('button', {
          name: 'Verweis Haupt',
        }),
      );
      const canvas = screen.getByTestId('canvas-panel');

      fireEvent.click(await within(canvas).findByRole('button', { name: 'Nicht da' }));

      expect(
        await within(canvas).findByText('Dieses Element gibt es auf dem Canvas nicht mehr.'),
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(router.state.location.search).toEqual({});
      });
    });
  });

  describe('the history of a board (spec 38a)', () => {
    const ELEMENT = 'aaaaaaaa-0000-4000-8000-000000000009';
    const historyOf = (boardId: string) => `/api/projects/${PROJECT.id}/boards/${boardId}/history`;
    const entry = (label: string) => ({
      entries: [
        {
          id: 'e1',
          actor: { kind: 'agent', agentKey: 'moderator' },
          at: new Date().toISOString(),
          items: [{ id: ELEMENT, kind: 'block', label, action: 'added', present: true }],
        },
      ],
    });

    it('opens from the canvas for the board that is open, and leads to an element', async () => {
      const api = stubApi({
        [`GET /api/projects/${PROJECT.id}`]: () => ({
          body: { ...DETAILS, boards: [...DETAILS.boards, EXTRA_BOARD] },
        }),
        [`GET ${historyOf(EXTRA_BOARD.id)}`]: () => ({ body: entry('Anmelden') }),
      });
      const router = renderApp(`/p/${PROJECT.id}?board=${EXTRA_BOARD.id}`);
      const canvas = await screen.findByTestId('canvas-panel');
      // Loaded only once the dialog opens.
      expect(
        api.mock.calls.some(([input]) =>
          (input instanceof Request ? input.url : input.toString()).endsWith('/history'),
        ),
      ).toBe(false);

      expect(canvas).toHaveAttribute('data-board', EXTRA_BOARD.id);
      fireEvent.click(screen.getByRole('button', { name: 'Verlauf des Boards' }));

      const dialog = await screen.findByRole('dialog', { name: 'Verlauf' });
      fireEvent.click(
        await within(dialog).findByRole('button', { name: 'Zu „Anmelden“ auf dem Board' }),
      );

      // The dialog steps aside and the board brings the element into view.
      await waitFor(() => {
        expect(screen.queryByRole('dialog', { name: 'Verlauf' })).not.toBeInTheDocument();
      });
      expect(screen.getByTestId('canvas-panel')).toHaveAttribute('data-focus', ELEMENT);
      expect(router.state.location.search).toEqual({ board: EXTRA_BOARD.id, focus: ELEMENT });
    });

    it('is there for viewers too', async () => {
      stubApi({
        [`GET /api/projects/${PROJECT.id}`]: () => ({ body: { ...DETAILS, role: 'viewer' } }),
        [`GET ${historyOf(DETAILS.boards[0]?.id ?? '')}`]: () => ({ body: entry('API') }),
      });
      renderApp(`/p/${PROJECT.id}`);

      await screen.findByTestId('canvas-panel');
      fireEvent.click(screen.getByRole('button', { name: 'Verlauf des Boards' }));

      const dialog = await screen.findByRole('dialog', { name: 'Verlauf' });
      await within(dialog).findByRole('list', { name: 'Verlauf' });
      expect(dialog).toHaveTextContent('Moderator · 1 hinzugefügt');
    });
  });

  describe('exports (spec 27a)', () => {
    it('names the main canvas in the language of the project, whatever it was called (spec 32b)', async () => {
      stubApi({
        [`GET /api/projects/${PROJECT.id}`]: () => ({ body: { ...DETAILS, language: 'en' } }),
      });
      renderApp(`/p/${PROJECT.id}`);

      // The interface is German and the board was created as "Haupt-Canvas": the export is
      // the project's, and the project is English.
      expect(await screen.findByTestId('canvas-panel')).toHaveAttribute(
        'data-export',
        'covibes-v1-main-canvas|Main canvas|en',
      );
    });

    it('names the files of a board after the project and the board, also for viewers', async () => {
      stubApi({
        [`GET /api/projects/${PROJECT.id}`]: () => ({
          body: { ...DETAILS, role: 'viewer', boards: [...DETAILS.boards, EXTRA_BOARD] },
        }),
      });
      renderApp(`/p/${PROJECT.id}?board=${EXTRA_BOARD.id}`);

      const canvas = await screen.findByTestId('canvas-panel');
      expect(canvas).toHaveAttribute('data-export', `covibes-v1-ablauf|${EXTRA_BOARD.title}|de`);

      // An export that gave no file says so over the canvas.
      fireEvent.doubleClick(canvas);
      expect(
        await within(canvas).findByText(
          'Der Export hat nicht geklappt. Bitte versuche es noch einmal.',
        ),
      ).toBeInTheDocument();
    });

    it('gives the plan the name of the project for its exports', async () => {
      stubApi({ [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }) });
      renderApp(`/p/${PROJECT.id}?view=plan`);

      expect(await screen.findByTestId('plan-panel')).toHaveAttribute(
        'data-project-name',
        PROJECT.name,
      );
    });
  });

  describe('the roadmap (spec 26a)', () => {
    const OPEN_URL = `/api/projects/${PROJECT.id}/roadmap/open`;
    const FRAME_ID = '7c7c7c7c-7c7c-4c7c-8c7c-7c7c7c7c7c7c';

    it('opens the board that shows the roadmap from the plan and brings it into view', async () => {
      const api = stubApi({
        [`GET /api/projects/${PROJECT.id}`]: () => ({
          body: { ...DETAILS, boards: [...DETAILS.boards, EXTRA_BOARD] },
        }),
        [`POST ${OPEN_URL}`]: () => ({ body: { boardId: EXTRA_BOARD.id, nodeId: FRAME_ID } }),
      });
      const router = renderApp(`/p/${PROJECT.id}?view=plan`);
      const plan = await screen.findByTestId('plan-panel');

      fireEvent.click(within(plan).getByRole('button', { name: 'Roadmap' }));

      const canvas = await screen.findByTestId('canvas-panel');
      expect(canvas).toHaveAttribute('data-board', EXTRA_BOARD.id);
      expect(canvas).toHaveAttribute('data-focus', FRAME_ID);
      expect(api).toHaveBeenCalledWith(OPEN_URL, expect.objectContaining({ method: 'POST' }));

      // Once it is in view, the address forgets it, so a reload does not jump again.
      fireEvent.click(within(canvas).getByRole('button', { name: 'Im Blick' }));
      await waitFor(() => {
        expect(canvas).toHaveAttribute('data-focus', '');
      });
      expect(router.state.location.search).toEqual({ board: EXTRA_BOARD.id });
    });

    it('stays on the main canvas when the roadmap is there', async () => {
      stubApi({
        [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }),
        [`POST ${OPEN_URL}`]: () => ({
          status: 201,
          body: { boardId: DETAILS.boards[0]?.id, nodeId: FRAME_ID },
        }),
      });
      const router = renderApp(`/p/${PROJECT.id}?view=plan`);

      fireEvent.click(
        within(await screen.findByTestId('plan-panel')).getByRole('button', { name: 'Roadmap' }),
      );

      expect(await screen.findByTestId('canvas-panel')).toHaveAttribute('data-focus', FRAME_ID);
      expect(router.state.location.search).toEqual({ focus: FRAME_ID });
    });

    const ROADMAP_URL = `/api/projects/${PROJECT.id}/roadmap`;
    const TASK_ID = '7e7e7e7e-7e7e-4e7e-8e7e-7e7e7e7e7e7e';
    const OTHER_TASK = '8f8f8f8f-8f8f-4f8f-8f8f-8f8f8f8f8f8f';
    const tasksRoadmap = (assignee: { userId: string; name: string } | null) => ({
      milestones: [
        {
          number: 1,
          title: 'Grundgerüst',
          goal: '',
          duration: null,
          tasks: [
            { id: TASK_ID, text: 'Login bauen', assignee },
            { id: OTHER_TASK, text: 'Export', assignee: null },
            { id: null, text: 'Gerade geschrieben', assignee: null },
          ],
        },
      ],
    });

    it('gives the plan its tasks and assigns one at once (spec 26b)', async () => {
      let assignee: { userId: string; name: string } | null = null;
      const api = stubApi({
        [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }),
        [`GET ${ROADMAP_URL}`]: () => ({ body: tasksRoadmap(assignee) }),
        [`PUT ${ROADMAP_URL}/tasks/${TASK_ID}/assignee`]: (init) => {
          const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
            userId: string;
          };
          assignee = { userId: body.userId, name: 'Alex Berg' };
          return { status: 204, body: null };
        },
      });
      renderApp(`/p/${PROJECT.id}?view=plan`);
      const plan = await screen.findByTestId('plan-panel');
      // Only tasks that have their id can be assigned; the one written a moment ago waits.
      await waitFor(() => {
        expect(plan).toHaveAttribute('data-tasks', '7e7e:- 8f8f:-');
      });
      expect(plan).toHaveAttribute('data-members', `Alex Berg,${OLGA.name}`);

      fireEvent.click(within(plan).getByRole('button', { name: 'Erste Aufgabe zuweisen' }));

      // It shows before the server answered.
      await waitFor(() => {
        expect(plan).toHaveAttribute('data-tasks', '7e7e:Alex Berg 8f8f:-');
      });
      await waitFor(() => {
        expect(api).toHaveBeenCalledWith(
          `${ROADMAP_URL}/tasks/${TASK_ID}/assignee`,
          expect.objectContaining({
            method: 'PUT',
            body: JSON.stringify({ userId: DETAILS.members[0]?.userId }),
          }),
        );
      });
    });

    it('takes an assignment back and says so when the server refuses it', async () => {
      stubApi({
        [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }),
        [`GET ${ROADMAP_URL}`]: () => ({ body: tasksRoadmap(null) }),
        [`PUT ${ROADMAP_URL}/tasks/${TASK_ID}/assignee`]: () => ({
          status: 404,
          body: { error: { code: 'not_found', message: 'Not found.' } },
        }),
      });
      renderApp(`/p/${PROJECT.id}?view=plan`);
      const plan = await screen.findByTestId('plan-panel');
      await waitFor(() => {
        expect(plan).toHaveAttribute('data-tasks', '7e7e:- 8f8f:-');
      });

      fireEvent.click(within(plan).getByRole('button', { name: 'Erste Aufgabe zuweisen' }));

      expect(
        await within(plan).findByText(
          'Die Aufgabe konnte nicht zugewiesen werden. Bitte versuche es noch einmal.',
        ),
      ).toBeInTheDocument();
      await waitFor(() => {
        expect(plan).toHaveAttribute('data-tasks', '7e7e:- 8f8f:-');
      });
    });

    it('shows viewers the assignees without letting them assign', async () => {
      stubApi({
        [`GET /api/projects/${PROJECT.id}`]: () => ({ body: { ...DETAILS, role: 'viewer' } }),
        [`GET ${ROADMAP_URL}`]: () => ({
          body: tasksRoadmap({ userId: DETAILS.members[0]?.userId ?? '', name: 'Alex Berg' }),
        }),
      });
      renderApp(`/p/${PROJECT.id}?view=plan`);
      const plan = await screen.findByTestId('plan-panel');

      await waitFor(() => {
        expect(plan).toHaveAttribute('data-tasks', '7e7e:Alex Berg 8f8f:-');
      });
      expect(plan).toHaveAttribute('data-members', '');
      expect(
        within(plan).queryByRole('button', { name: 'Erste Aufgabe zuweisen' }),
      ).not.toBeInTheDocument();
    });

    it('tells viewers when there is no roadmap yet', async () => {
      stubApi({
        [`GET /api/projects/${PROJECT.id}`]: () => ({ body: { ...DETAILS, role: 'viewer' } }),
        [`POST ${OPEN_URL}`]: () => ({
          status: 404,
          body: { error: { code: 'not_found', message: 'Not found.' } },
        }),
      });
      renderApp(`/p/${PROJECT.id}?view=plan`);
      const plan = await screen.findByTestId('plan-panel');

      fireEvent.click(within(plan).getByRole('button', { name: 'Roadmap' }));

      expect(await within(plan).findByText('Es gibt noch keine Roadmap.')).toBeInTheDocument();
      expect(screen.queryByTestId('canvas-panel')).not.toBeInTheDocument();
    });
  });

  it('opens the board named in the address and falls back to the main canvas', async () => {
    stubApi({
      [`GET /api/projects/${PROJECT.id}`]: () => ({
        body: { ...DETAILS, boards: [...DETAILS.boards, EXTRA_BOARD] },
      }),
    });
    const router = renderApp(`/p/${PROJECT.id}?board=${EXTRA_BOARD.id}`);
    expect(await screen.findByTestId('canvas-panel')).toHaveAttribute('data-board', EXTRA_BOARD.id);

    // An unknown board (e.g. an old link) opens the main canvas without a note.
    await act(() =>
      router.navigate({
        to: '/p/$projectId',
        params: { projectId: PROJECT.id },
        search: { board: '55555555-5555-4555-8555-555555555555' },
      }),
    );
    await waitFor(() => {
      expect(router.state.location.search).toEqual({});
    });
    expect(screen.getByTestId('canvas-panel')).toHaveAttribute('data-board', DETAILS.boards[0]?.id);
    expect(screen.getByTestId('canvas-panel')).toHaveAttribute('data-notice', '');
  });

  it('opens the main canvas with a note when someone deletes the open board', async () => {
    let boards: ProjectDetails['boards'] = [...DETAILS.boards, EXTRA_BOARD];
    stubApi({ [`GET /api/projects/${PROJECT.id}`]: () => ({ body: { ...DETAILS, boards } }) });
    const router = renderApp(`/p/${PROJECT.id}?board=${EXTRA_BOARD.id}`);
    expect(await screen.findByTestId('canvas-panel')).toHaveAttribute('data-board', EXTRA_BOARD.id);

    boards = DETAILS.boards;
    act(() => {
      live.handlers?.onEvent({ type: 'boards' });
    });

    const canvas = screen.getByTestId('canvas-panel');
    await waitFor(() => {
      expect(canvas).toHaveAttribute('data-board', DETAILS.boards[0]?.id);
    });
    expect(canvas).toHaveTextContent('Dieses Board wurde gelöscht.');
    expect(router.state.location.search).toEqual({});
  });

  it('opens the share dialog from the header', async () => {
    stubApi({
      [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }),
      [`GET /api/projects/${PROJECT.id}/invitations`]: () => ({ body: [] }),
      'GET /api/config': () => ({ body: CONFIG }),
    });
    renderApp(`/p/${PROJECT.id}`);

    fireEvent.click(await screen.findByRole('button', { name: 'Teilen' }));

    const dialog = await screen.findByRole('dialog', { name: '„Covibes V1“ teilen' });
    expect(within(dialog).getByRole('region', { name: 'Mitglieder' })).toHaveTextContent(
      '2 Mitglieder',
    );
    expect(within(dialog).getByRole('button', { name: 'Link erstellen' })).toBeInTheDocument();
  });

  it('says so when the access to the open project was taken away', async () => {
    let member = true;
    stubApi({
      [`GET /api/projects/${PROJECT.id}`]: () =>
        member
          ? { body: DETAILS }
          : { status: 404, body: { error: { code: 'not_found', message: 'Not found.' } } },
    });
    renderApp(`/p/${PROJECT.id}`);
    expect(await screen.findByTestId('chat-panel')).toBeInTheDocument();

    // The server tells the tab to load the project again before it closes the connection.
    member = false;
    act(() => {
      live.handlers?.onEvent({ type: 'project' });
    });

    expect(
      await screen.findByRole('heading', { name: 'Du bist nicht mehr in diesem Projekt' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Ein Owner hat dich aus „Covibes V1“ entfernt/)).toBeInTheDocument();
    expect(screen.queryByTestId('chat-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zur Projektliste' })).toHaveAttribute('href', '/');
  });

  describe('an invitation link', () => {
    const TOKEN = 'T'.repeat(43);
    const preview = (body: Record<string, unknown>) => ({
      body: { projectId: null, projectName: null, role: null, invitedBy: null, ...body },
    });

    it('says who invites to what and joins on request', async () => {
      const api = stubApi({
        'POST /api/invitations/preview': () =>
          preview({ status: 'open', projectName: 'Vereins-App', role: 'viewer', invitedBy: 'Sam' }),
        'POST /api/invitations/accept': () => ({
          body: { status: 'joined', projectId: PROJECT.id },
        }),
        [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }),
      });
      const router = renderApp(`/invite/${TOKEN}`);

      expect(
        await screen.findByRole('heading', { name: 'Einladung zu „Vereins-App“' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Sam lädt dich ein, als Leser mitzumachen.')).toBeInTheDocument();
      // Someone who is invited may not read the language the page starts in (spec 32a).
      expect(screen.getByRole('group', { name: 'Sprache' })).toBeInTheDocument();
      expect(
        screen.getByText('Als Leser siehst du Chat und Canvas, änderst aber nichts.'),
      ).toBeInTheDocument();
      // Opening the link alone joins nothing.
      expect(api).not.toHaveBeenCalledWith('/api/invitations/accept', expect.anything());

      fireEvent.click(screen.getByRole('button', { name: 'Beitreten' }));

      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/p/${PROJECT.id}`);
      });
      // The token travels in the body, never in an address of the API.
      expect(api).toHaveBeenCalledWith(
        '/api/invitations/accept',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ token: TOKEN }) }),
      );
    });

    it('leads a member straight to the project', async () => {
      stubApi({
        'POST /api/invitations/preview': () =>
          preview({ status: 'member', projectId: PROJECT.id, projectName: 'Vereins-App' }),
        [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }),
      });
      const router = renderApp(`/invite/${TOKEN}`);

      expect(await screen.findByRole('heading', { name: 'Du bist schon dabei' })).toBeVisible();
      fireEvent.click(screen.getByRole('button', { name: 'Zum Projekt' }));

      await waitFor(() => {
        expect(router.state.location.pathname).toBe(`/p/${PROJECT.id}`);
      });
    });

    it.each([
      ['expired', 'Diese Einladung ist abgelaufen'],
      ['revoked', 'Diese Einladung gilt nicht mehr'],
      ['used', 'Diese Einladung wurde schon genutzt'],
    ])('says so when the invitation is %s', async (status, title) => {
      stubApi({ 'POST /api/invitations/preview': () => preview({ status }) });
      renderApp(`/invite/${TOKEN}`);

      expect(await screen.findByRole('heading', { name: title })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Beitreten' })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Zur Projektliste' })).toHaveAttribute('href', '/');
    });

    it('says so for a link nobody issued', async () => {
      stubApi({});
      renderApp(`/invite/kaputt`);
      expect(
        await screen.findByRole('heading', { name: 'Diese Einladung gibt es nicht' }),
      ).toBeInTheDocument();
    });

    it('explains when joining does not work out', async () => {
      stubApi({
        'POST /api/invitations/preview': () =>
          preview({ status: 'open', projectName: 'Vereins-App', role: 'editor', invitedBy: 'Sam' }),
        'POST /api/invitations/accept': () => ({ body: { status: 'full', projectId: null } }),
      });
      const router = renderApp(`/invite/${TOKEN}`);

      fireEvent.click(await screen.findByRole('button', { name: 'Beitreten' }));

      expect(await screen.findByRole('heading', { name: 'Das Projekt ist voll' })).toBeVisible();
      expect(router.state.location.pathname).toBe(`/invite/${TOKEN}`);
    });
  });

  it('shows "Projekt nicht gefunden" for projects without access', async () => {
    stubApi({});
    renderApp(`/p/${PROJECT.id}`);

    expect(
      await screen.findByRole('heading', { name: 'Projekt nicht gefunden' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Zur Projektliste' })).toHaveAttribute('href', '/');
  });

  it('turns the notification mails off in the account menu (spec 22b)', async () => {
    let email = true;
    const api = stubApi({
      'GET /api/projects': () => ({ body: [] }),
      'GET /api/config': () => ({ body: CONFIG }),
      'GET /api/notifications/settings': () => ({ body: { email } }),
      'PATCH /api/notifications/settings': (init) => {
        const wanted = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
          email: boolean;
        };
        ({ email } = wanted);
        return { body: { email } };
      },
    });
    renderApp('/');

    fireEvent.keyDown(await screen.findByRole('button', { name: 'Konto' }), { key: 'Enter' });
    const mails = await screen.findByRole('menuitemcheckbox', {
      name: 'E-Mail-Benachrichtigungen',
    });
    // On until the person turns it off.
    expect(mails).toBeChecked();
    fireEvent.click(mails);

    await waitFor(() => {
      expect(mails).not.toBeChecked();
    });
    expect(api).toHaveBeenCalledWith(
      '/api/notifications/settings',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ email: false }) }),
    );
    // The menu stays open, so the switch can be seen changing.
    expect(screen.getByRole('menuitem', { name: 'Abmelden' })).toBeInTheDocument();
  });

  it('shows the interface in the language of the account, and changes it from the account menu', async () => {
    signedIn({ ...OLGA, locale: 'en' });
    stubApi({
      'GET /api/projects': () => ({ body: [] }),
      'GET /api/config': () => ({ body: CONFIG }),
      'GET /api/notifications/settings': () => ({ body: { email: true } }),
    });
    renderApp('/');

    // The account is English: so is the page, without anyone choosing.
    fireEvent.keyDown(await screen.findByRole('button', { name: 'Account' }), { key: 'Enter' });
    const languages = within(await screen.findByRole('group', { name: 'Language' }));
    expect(languages.getByRole('menuitemradio', { name: 'English' })).toBeChecked();
    expect(languages.getByRole('menuitemradio', { name: 'Deutsch' })).not.toBeChecked();
    expect(authClient.updateUser).not.toHaveBeenCalled();

    fireEvent.click(languages.getByRole('menuitemradio', { name: 'Deutsch' }));

    expect(authClient.updateUser).toHaveBeenCalledWith({ locale: 'de' });
    expect(await screen.findByRole('button', { name: 'Konto' })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('de');
  });

  it('offers no switch for mails when the server cannot send any', async () => {
    stubApi({
      'GET /api/projects': () => ({ body: [] }),
      'GET /api/config': () => ({ body: { ...CONFIG, emailLogin: false } }),
      'GET /api/notifications/settings': () => ({ body: { email: true } }),
    });
    renderApp('/');

    fireEvent.keyDown(await screen.findByRole('button', { name: 'Konto' }), { key: 'Enter' });

    expect(await screen.findByRole('menuitem', { name: 'Abmelden' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemcheckbox')).not.toBeInTheDocument();
  });

  it('signs out from the account menu', async () => {
    stubApi({
      'GET /api/projects': () => ({ body: [] }),
      'GET /api/config': () => ({ body: CONFIG }),
    });
    const router = renderApp('/');

    fireEvent.keyDown(await screen.findByRole('button', { name: 'Konto' }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Abmelden' }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/login');
    });
    expect(authClient.signOut).toHaveBeenCalled();
    expect(
      await screen.findByRole('heading', { name: 'Bei Covibes anmelden' }),
    ).toBeInTheDocument();
  });
});
