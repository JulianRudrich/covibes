import type { Notification, NotificationList } from '@covibes/shared';
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

const OLGA = { id: '11111111-1111-4111-8111-111111111111', name: 'Olga', email: 'o@example.com' };
const PROJECT = '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';

const base = {
  projectId: PROJECT,
  projectName: 'Vereins-App',
  actorName: 'Sam',
  excerpt: '',
  role: null,
  createdAt: new Date().toISOString(),
  read: false,
} satisfies Partial<Notification>;

const MENTION: Notification = {
  ...base,
  id: '22222222-2222-4222-8222-222222222222',
  kind: 'mention',
  excerpt: '@Olga schaust du dir das Datenmodell an?',
};
const ROLE: Notification = {
  ...base,
  id: '33333333-3333-4333-8333-333333333333',
  kind: 'role_changed',
  role: 'viewer',
};
const REMOVED: Notification = {
  ...base,
  id: '44444444-4444-4444-8444-444444444444',
  kind: 'removed',
  projectName: 'Altes Projekt',
};
const JOINED: Notification = {
  ...base,
  id: '55555555-5555-4555-8555-555555555555',
  kind: 'joined',
  actorName: 'Alex',
  role: 'editor',
  read: true,
};

/** A server that keeps the notifications in memory and marks them as read. */
function stubNotifications(initial: Notification[]) {
  let notifications = initial;
  const read: unknown[] = [];
  const api = stubApi({
    'GET /api/projects': () => ({ body: [] }),
    'GET /api/config': () => ({
      body: { gitlabLogin: false, emailLogin: true, devMailbox: false },
    }),
    'GET /api/notifications': () => ({
      body: {
        notifications,
        unread: notifications.filter((entry) => !entry.read).length,
      } satisfies NotificationList,
    }),
    'POST /api/notifications/read': (init) => {
      const target = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        ids?: string[];
        all?: true;
      };
      read.push(target);
      notifications = notifications.map((entry) =>
        target.all || target.ids?.includes(entry.id) ? { ...entry, read: true } : entry,
      );
      return { status: 204, body: null };
    },
  });
  return { api, read };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(authClient.getSession).mockResolvedValue({
    data: { user: OLGA, session: {} },
    error: null,
  });
});

describe('NotificationBell', () => {
  it('shows how many notifications are unread and lists what happened', async () => {
    stubNotifications([MENTION, ROLE, REMOVED, JOINED]);
    renderApp('/');

    const bell = await screen.findByRole('button', { name: 'Benachrichtigungen, 3 ungelesen' });
    expect(bell).toHaveTextContent('3');
    fireEvent.click(bell);

    const list = await screen.findByRole('dialog', { name: 'Benachrichtigungen' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining(
        'Sam hat dich in Vereins-App erwähnt@Olga schaust du dir das Datenmodell an?',
      ),
      expect.stringContaining('Sam hat deine Rolle in Vereins-App geändert: Leser'),
      expect.stringContaining('Sam hat dich aus Altes Projekt entfernt'),
      expect.stringContaining('Alex ist Vereins-App beigetreten, als Bearbeiter'),
    ]);
    // Three are marked as unread, the last one is read.
    expect(within(list).getAllByRole('img', { name: 'ungelesen' })).toHaveLength(3);
    expect(within(rows[3] as HTMLElement).queryByRole('img', { name: 'ungelesen' })).toBeNull();
  });

  it('opens the project of a notification and reads it', async () => {
    const { read } = stubNotifications([MENTION, ROLE]);
    const router = renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: /2 ungelesen/ }));

    fireEvent.click(await screen.findByRole('button', { name: /hat dich in Vereins-App erwähnt/ }));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(`/p/${PROJECT}`);
    });
    expect(read).toEqual([{ ids: [MENTION.id] }]);
  });

  it('reads a removal without leaving the page: there is no project to open', async () => {
    const { read } = stubNotifications([REMOVED]);
    const router = renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: /1 ungelesen/ }));

    fireEvent.click(await screen.findByRole('button', { name: /aus Altes Projekt entfernt/ }));

    await waitFor(() => {
      expect(read).toEqual([{ ids: [REMOVED.id] }]);
    });
    expect(router.state.location.pathname).toBe('/');
    // Shown as read at once; the counter is gone.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Benachrichtigungen' })).toBeInTheDocument();
    });
  });

  it('marks all as read', async () => {
    const { read } = stubNotifications([MENTION, ROLE, JOINED]);
    renderApp('/');
    fireEvent.click(await screen.findByRole('button', { name: /2 ungelesen/ }));
    const list = await screen.findByRole('dialog', { name: 'Benachrichtigungen' });

    fireEvent.click(within(list).getByRole('button', { name: 'Alle als gelesen markieren' }));

    await waitFor(() => {
      expect(within(list).queryAllByRole('img', { name: 'ungelesen' })).toEqual([]);
    });
    expect(read).toEqual([{ all: true }]);
    expect(
      within(list).queryByRole('button', { name: 'Alle als gelesen markieren' }),
    ).not.toBeInTheDocument();
  });

  it('says so when there is nothing, and asks again when the window gets the focus', async () => {
    const { api } = stubNotifications([]);
    renderApp('/');

    const bell = await screen.findByRole('button', { name: 'Benachrichtigungen' });
    fireEvent.click(bell);
    expect(await screen.findByText('Keine Benachrichtigungen.')).toBeInTheDocument();

    const asked = () => api.mock.calls.filter(([input]) => input === '/api/notifications').length;
    const before = asked();
    act(() => {
      window.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => {
      expect(asked()).toBeGreaterThan(before);
    });
  });
});
