import type { Invitation, ProjectDetails, ProjectMember } from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from '@web/components/ui/dialog';
import { ShareDialog } from '@web/features/share/share-dialog';

const PROJECT_ID = '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const BASE = `/api/projects/${PROJECT_ID}`;
const OLGA: ProjectMember = {
  userId: '11111111-1111-4111-8111-111111111111',
  name: 'Olga',
  role: 'owner',
  canApproveGit: true,
};
const ALEX: ProjectMember = {
  userId: '22222222-2222-4222-8222-222222222222',
  name: 'Alex Berg',
  role: 'editor',
  canApproveGit: false,
};
const VERA: ProjectMember = {
  userId: '33333333-3333-4333-8333-333333333333',
  name: 'Vera',
  role: 'viewer',
  canApproveGit: false,
};

const LINK: Invitation = {
  id: '44444444-4444-4444-8444-444444444444',
  kind: 'link',
  role: 'viewer',
  email: null,
  createdAt: '2026-10-02T10:00:00.000Z',
  expiresAt: '2026-10-09T10:00:00.000Z',
  uses: 2,
};
const MAIL: Invitation = {
  ...LINK,
  id: '55555555-5555-4555-8555-555555555555',
  kind: 'email',
  role: 'editor',
  email: 'sam@example.com',
  uses: 0,
};

type Call = { url: string; method: string; body: unknown };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A server that keeps the invitations in memory, or fails every change with `failWith`. */
function stubServer(initial: Invitation[] = [], failWith?: { code: string; status: number }) {
  let invitations = [...initial];
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      if (method === 'GET') return Promise.resolve(json(invitations));
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ url, method, body });
      if (failWith) {
        return Promise.resolve(
          json({ error: { code: failWith.code, message: 'No' } }, failWith.status),
        );
      }
      if (method === 'DELETE' || method === 'PATCH') {
        invitations = invitations.filter((invitation) => !url.endsWith(invitation.id));
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url.endsWith('/resend')) return Promise.resolve(json(MAIL));
      const wanted = body as { kind: 'link' | 'email'; role: 'editor' | 'viewer'; email?: string };
      const invitation: Invitation = {
        ...LINK,
        id: crypto.randomUUID(),
        kind: wanted.kind,
        role: wanted.role,
        email: wanted.email ?? null,
        uses: 0,
      };
      invitations = [...invitations, invitation];
      return Promise.resolve(
        json(
          {
            invitation,
            url: wanted.kind === 'link' ? `http://localhost:5173/invite/${'t'.repeat(43)}` : null,
          },
          201,
        ),
      );
    }),
  );
  return calls;
}

function renderDialog({
  role = 'owner',
  members = [OLGA, ALEX, VERA],
  userId = OLGA.userId,
  emailInvites = true,
}: {
  role?: ProjectDetails['role'];
  members?: ProjectMember[];
  userId?: string;
  emailInvites?: boolean;
} = {}) {
  const onLeft = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <Dialog open>
        <ShareDialog
          project={{ id: PROJECT_ID, name: 'Vereins-App', role, members }}
          userId={userId}
          emailInvites={emailInvites}
          devMailbox
          onLeft={onLeft}
        />
      </Dialog>
    </QueryClientProvider>,
  );
  return { onLeft, dialog: screen.getByRole('dialog', { name: '„Vereins-App“ teilen' }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ShareDialog for an owner', () => {
  it('invites by mail with a role and says that the mail is on its way', async () => {
    const calls = stubServer();
    const { dialog } = renderDialog();
    const email = within(dialog).getByLabelText('E-Mail-Adresse der eingeladenen Person');
    expect(within(dialog).getByRole('button', { name: 'Einladen' })).toBeDisabled();

    fireEvent.change(email, { target: { value: 'kein-at-zeichen' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Einladen' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('gültige E-Mail-Adresse');
    expect(calls).toEqual([]);

    fireEvent.change(email, { target: { value: ' sam@example.com ' } });
    fireEvent.change(within(dialog).getByLabelText('Rolle der Einladung'), {
      target: { value: 'viewer' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Einladen' }));

    expect(await within(dialog).findByRole('status')).toHaveTextContent(
      'Einladung an sam@example.com gesendet. Der Link gilt 7 Tage und nur einmal.',
    );
    expect(calls).toEqual([
      {
        url: `${BASE}/invitations`,
        method: 'POST',
        body: { kind: 'email', role: 'viewer', email: 'sam@example.com' },
      },
    ]);
    expect(email).toHaveValue('');
    expect(
      within(dialog).getByRole('link', { name: 'Entwicklungs-Postfach öffnen' }),
    ).toHaveAttribute('href', '/dev/mails');
    // The invitation waits in the list.
    const open = await within(dialog).findByRole('region', { name: 'Offene Einladungen' });
    expect(open).toHaveTextContent('sam@example.comLeser · gültig bis 9. Okt.');
  });

  it('creates a link, shows it once and copies it', async () => {
    const calls = stubServer();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const { dialog } = renderDialog();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Link erstellen' }));

    const link = await within(dialog).findByLabelText('Einladungslink');
    expect(link).toHaveValue(`http://localhost:5173/invite/${'t'.repeat(43)}`);
    expect(link).toHaveAttribute('readonly');
    expect(dialog).toHaveTextContent(
      'Wer diesen Link hat, tritt 7 Tage lang als Bearbeiter bei. Er wird nur jetzt angezeigt',
    );
    expect(calls).toEqual([
      { url: `${BASE}/invitations`, method: 'POST', body: { kind: 'link', role: 'editor' } },
    ]);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Kopieren' }));
    expect(await within(dialog).findByRole('button', { name: 'Kopiert' })).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(`http://localhost:5173/invite/${'t'.repeat(43)}`);
  });

  it('lists the open invitations, sends a mail again and revokes', async () => {
    const calls = stubServer([LINK, MAIL]);
    const { dialog } = renderDialog();

    const open = await within(dialog).findByRole('region', { name: 'Offene Einladungen' });
    const [link, mail] = within(open).getAllByRole('listitem');
    expect(link).toHaveTextContent('EinladungslinkLeser · gültig bis 9. Okt. · 2× genutzt');
    expect(mail).toHaveTextContent('sam@example.comBearbeiter · gültig bis 9. Okt.');
    // Only a mail can be sent again.
    expect(within(link as HTMLElement).queryByRole('button', { name: /erneut senden/ })).toBeNull();

    fireEvent.click(
      within(open).getByRole('button', { name: 'Einladung an sam@example.com erneut senden' }),
    );
    expect(await within(dialog).findByRole('status')).toHaveTextContent(
      'Einladung an sam@example.com gesendet.',
    );
    fireEvent.click(
      within(open).getByRole('button', { name: 'Einladung widerrufen: Einladungslink' }),
    );
    await waitFor(() => {
      expect(within(open).getAllByRole('listitem')).toHaveLength(1);
    });
    expect(calls).toEqual([
      { url: `${BASE}/invitations/${MAIL.id}/resend`, method: 'POST', body: undefined },
      { url: `${BASE}/invitations/${LINK.id}`, method: 'DELETE', body: undefined },
    ]);
  });

  it('offers only links when the server cannot send mail, and explains refusals', async () => {
    stubServer([], { code: 'limit_reached', status: 409 });
    const { dialog } = renderDialog({ emailInvites: false });

    expect(within(dialog).queryByLabelText(/E-Mail-Adresse/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Einladen' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Link erstellen' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Es sind schon 20 Einladungen offen.',
    );
  });

  it('changes roles, grants the Git approval right and removes members after a second click', async () => {
    const calls = stubServer();
    const { dialog } = renderDialog();
    const members = within(dialog).getByRole('region', { name: 'Mitglieder' });
    expect(members).toHaveTextContent('3 Mitglieder');
    expect(within(members).getAllByRole('listitem')[0]).toHaveTextContent('Olga (Du)');

    fireEvent.change(within(members).getByLabelText('Rolle von Vera'), {
      target: { value: 'editor' },
    });
    // Only editors have the right to grant; owners approve anyway, viewers never.
    const approves = within(members).getByRole('checkbox', { name: 'darf Git-Aktionen freigeben' });
    expect(within(members).getAllByRole('checkbox')).toHaveLength(1);
    expect(approves).not.toBeChecked();
    // One change at a time: the controls wait while the server answers.
    await waitFor(() => {
      expect(approves).toBeEnabled();
    });
    fireEvent.click(approves);

    const remove = within(members).getByRole('button', { name: 'Alex Berg entfernen' });
    await waitFor(() => {
      expect(remove).toBeEnabled();
    });
    fireEvent.click(remove);
    expect(calls).toHaveLength(2);
    fireEvent.click(within(members).getByRole('button', { name: 'Entfernen' }));

    await waitFor(() => {
      expect(calls).toHaveLength(3);
    });
    expect(calls).toEqual([
      { url: `${BASE}/members/${VERA.userId}`, method: 'PATCH', body: { role: 'editor' } },
      { url: `${BASE}/members/${ALEX.userId}`, method: 'PATCH', body: { canApproveGit: true } },
      { url: `${BASE}/members/${ALEX.userId}`, method: 'DELETE', body: undefined },
    ]);
    // Nobody removes themselves here; leaving has its own button.
    expect(within(members).queryByRole('button', { name: 'Olga entfernen' })).toBeNull();
  });

  it('keeps the last owner in the role and in the project', () => {
    stubServer();
    const { dialog } = renderDialog();

    expect(within(dialog).getByLabelText('Rolle von Olga')).toBeDisabled();
    const leave = within(dialog).getByRole('button', { name: 'Projekt verlassen' });
    expect(leave).toBeDisabled();
    expect(leave).toHaveAccessibleDescription(
      'Als einziger Owner kannst du nicht gehen. Mach erst jemanden zum Owner.',
    );
  });

  it('lets an owner step down and leave once there is another owner', async () => {
    const calls = stubServer();
    const { dialog, onLeft } = renderDialog({ members: [OLGA, { ...ALEX, role: 'owner' }, VERA] });

    expect(within(dialog).getByLabelText('Rolle von Olga')).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Projekt verlassen' }));
    expect(dialog).toHaveTextContent('Du verlierst den Zugriff. Deine Nachrichten bleiben.');
    expect(calls).toEqual([]);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Wirklich verlassen' }));

    await waitFor(() => {
      expect(onLeft).toHaveBeenCalledOnce();
    });
    expect(calls).toEqual([
      { url: `${BASE}/members/${OLGA.userId}`, method: 'DELETE', body: undefined },
    ]);
  });

  it('says so when the server refuses a change', async () => {
    stubServer([], { code: 'last_owner', status: 409 });
    const { dialog } = renderDialog({ members: [OLGA, { ...ALEX, role: 'owner' }] });

    fireEvent.change(within(dialog).getByLabelText('Rolle von Alex Berg'), {
      target: { value: 'viewer' },
    });

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Ein Projekt braucht mindestens einen Owner.',
    );
  });
});

describe('ShareDialog for everyone else', () => {
  it('shows who is in the project, without inviting or managing', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { dialog } = renderDialog({
      role: 'editor',
      userId: ALEX.userId,
      members: [OLGA, { ...ALEX, canApproveGit: true }, VERA],
    });

    expect(dialog).toHaveTextContent('Einladen und Rollen ändern können Owner.');
    expect(within(dialog).queryByRole('region', { name: 'Einladen' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /entfernen/ })).not.toBeInTheDocument();
    const rows = within(dialog).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent)).toEqual([
      'OOlgaOwner',
      'ABAlex Berg (Du)darf Git-Aktionen freigebenBearbeiter',
      'VVeraLeser',
    ]);
    // The invitations are the owners' business: they are not even asked for.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('button', { name: 'Projekt verlassen' })).toBeEnabled();
  });
});
