import type { ProjectDetails, ProjectSummary, PublicConfig } from '@covibes/shared';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
    { userId: '22222222-2222-4222-8222-222222222222', name: 'Alex Berg', role: 'editor' },
    { userId: OLGA.id, name: OLGA.name, role: 'owner' },
  ],
};
const CONFIG: PublicConfig = { gitlabLogin: false, devMailbox: true };

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

  it('opens the workspace with the real members, the own one as „Du“', async () => {
    stubApi({ [`GET /api/projects/${PROJECT.id}`]: () => ({ body: DETAILS }) });
    renderApp(`/p/${PROJECT.id}`);

    expect(await screen.findByRole('link', { name: /Covibes V1/ })).toBeInTheDocument();
    const humans = screen.getByRole('group', { name: 'Menschen' });
    const avatars = within(humans).getAllByRole('img');
    expect(avatars.map((avatar) => avatar.getAttribute('aria-label'))).toEqual(['Du', 'Alex Berg']);
    expect(within(humans).getByText('AB')).toBeInTheDocument();
  });

  it('shows „Projekt nicht gefunden“ for projects without access', async () => {
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
