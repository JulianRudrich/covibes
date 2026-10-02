import type {
  LiveEvent,
  ProjectBoard,
  ProjectDetails,
  ProjectSummary,
  PublicConfig,
  SharedProject,
} from '@covibes/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authClient } from '@web/lib/auth-client';
import { renderApp, stubApi } from '@web/test-utils';

vi.mock('@web/lib/auth-client', () => ({
  authClient: {
    getSession: vi.fn(),
    signIn: { magicLink: vi.fn(), social: vi.fn() },
    signOut: vi.fn(),
  },
}));

// Canvas and chat need the live server; their parts have their own tests.
vi.mock('@web/features/chat/chat-panel', async () => {
  const { createElement } = await import('react');
  return {
    ChatPanel: (props: { projectId: string; readOnly: boolean }) =>
      createElement('div', {
        'data-testid': 'chat-panel',
        'data-project': props.projectId,
        'data-readonly': String(props.readOnly),
      }),
  };
});
vi.mock('@web/features/canvas/canvas-panel', async () => {
  const { createElement } = await import('react');
  return {
    CanvasPanel: (props: { boardId: string; readOnly: boolean; notice: string | null }) =>
      createElement(
        'div',
        {
          'data-testid': 'canvas-panel',
          'data-board': props.boardId,
          'data-readonly': String(props.readOnly),
        },
        props.notice,
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
  agents: [{ key: 'moderator', model: null }],
  customAgents: [],
};
const EXTRA_BOARD: ProjectBoard = {
  id: '44444444-4444-4444-8444-444444444444',
  title: 'Ablauf',
  kind: 'extra',
};
const CONFIG: PublicConfig = { gitlabLogin: false, emailLogin: true, devMailbox: true };

function signedIn(user: typeof OLGA | null) {
  vi.mocked(authClient.getSession).mockResolvedValue({
    data: user ? { user, session: {} } : null,
    error: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authClient.signIn.magicLink).mockResolvedValue({ data: {}, error: null });
  vi.mocked(authClient.signOut).mockResolvedValue({ data: {}, error: null });
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

  it('shows the GitLab login disabled until it is set up', async () => {
    renderApp('/login');

    const gitlab = await screen.findByRole('button', { name: 'Mit GitLab anmelden' });
    expect(gitlab).toBeDisabled();
    expect(gitlab).toHaveAccessibleDescription('Der Login mit GitLab ist noch nicht eingerichtet.');
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
    });
    expect(screen.getByRole('link', { name: 'Entwicklungs-Postfach öffnen' })).toBeInTheDocument();
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

    const gitlab = await screen.findByRole('button', { name: 'Mit GitLab anmelden' });
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
    expect(await screen.findByTestId('shared-board')).toHaveTextContent('API');

    // The overview: decisions and criteria, without the log and without anything to edit.
    const overview = screen.getByRole('region', { name: 'Überblick' });
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

    expect(await screen.findByRole('heading', { name: 'Projekte' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('shows a friendly empty project list', async () => {
    stubApi({ 'GET /api/projects': () => ({ body: [] }) });
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'Noch keine Projekte' })).toBeInTheDocument();
  });

  it('lists projects with role and last change', async () => {
    stubApi({ 'GET /api/projects': () => ({ body: [PROJECT] }) });
    renderApp('/');

    const link = await screen.findByRole('link', { name: /Covibes V1/ });
    expect(link).toHaveAttribute('href', `/p/${PROJECT.id}`);
    expect(within(link).getByText('Owner')).toBeInTheDocument();
    expect(within(link).getByText('geändert jetzt')).toBeInTheDocument();
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
    expect(post?.[1]?.body).toBe(JSON.stringify({ name: 'Covibes V1' }));
  });

  it('opens the workspace with the real members, the own one as "Du"', async () => {
    stubApi({ [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }) });
    renderApp(`/p/${PROJECT.id}`);

    expect(await screen.findByRole('button', { name: /Covibes V1/ })).toBeInTheDocument();
    const humans = screen.getByRole('group', { name: 'Menschen' });
    const avatars = within(humans).getAllByRole('img');
    expect(avatars.map((avatar) => avatar.getAttribute('aria-label'))).toEqual(['Du', 'Alex Berg']);
    expect(within(humans).getByText('AB')).toBeInTheDocument();
    const canvas = screen.getByTestId('canvas-panel');
    expect(canvas).toHaveAttribute('data-board', DETAILS.boards[0]?.id);
    expect(canvas).toHaveAttribute('data-readonly', 'false');
    const chat = screen.getByTestId('chat-panel');
    expect(chat).toHaveAttribute('data-project', PROJECT.id);
    expect(chat).toHaveAttribute('data-readonly', 'false');
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

    fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));
    fireEvent.keyDown(menu, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Zur Projektliste' }));
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
  });

  it('shows editors the project settings without letting them change anything', async () => {
    stubApi({
      [`GET /api/projects/${PROJECT.id}`]: () => ({
        body: { ...DETAILS, role: 'editor', proposalsOnly: true, decisionProcess: 'owner' },
      }),
    });
    renderApp(`/p/${PROJECT.id}`);

    fireEvent.keyDown(await screen.findByRole('button', { name: /Covibes V1/ }), { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Einstellungen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Projekteinstellungen' });

    expect(dialog).toHaveTextContent('Nur Owner ändern die Einstellungen.');
    expect(within(dialog).getByRole('radio', { name: /Owner entscheidet/ })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /Nur Vorschläge/ })).toBeChecked();
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
    expect(screen.getByTestId('canvas-panel')).toBeEmptyDOMElement();
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
