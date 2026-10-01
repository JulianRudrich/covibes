import type { CustomAgent } from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from '@web/components/ui/dialog';
import { TooltipProvider } from '@web/components/ui/tooltip';
import { AgentEditor } from '@web/features/agents/agent-editor';
import { AgentDirectoryProvider } from '@web/features/agents/agent-directory';
import { TeamMenu } from '@web/features/team/team-menu';

const PROJECT = { id: '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de', name: 'Vereins-App' };
const OLGA = '11111111-1111-4111-8111-111111111111';
const EDDIE = '22222222-2222-4222-8222-222222222222';

const JURIST: CustomAgent = {
  key: '33333333-3333-4333-8333-333333333333',
  name: 'Jurist',
  role: 'Prüft Verträge',
  instructions: 'Nenne die Rechtsgrundlage.',
  color: 2,
  model: null,
  canDraw: true,
  scope: 'personal',
  projectId: null,
  ownerId: OLGA,
  ownerName: 'Olga',
  template: null,
  deleted: false,
};

type Call = { url: string; method: string; body: unknown };

/** Answers every request with `response` and keeps what was sent. */
function stubApi(response: () => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      });
      return Promise.resolve(response());
    }),
  );
  return calls;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function renderEditor(agent: CustomAgent | null, userId = OLGA) {
  const onCreated = vi.fn();
  const onDone = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Dialog open>
        <AgentEditor
          agent={agent}
          project={PROJECT}
          userId={userId}
          defaultColor={4}
          onCreated={onCreated}
          onDone={onDone}
        />
      </Dialog>
    </QueryClientProvider>,
  );
  return { onCreated, onDone, dialog: screen.getByRole('dialog') };
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AgentEditor: a new agent', () => {
  it('starts from a catalog specialist and joins the team once created', async () => {
    const created = { ...JURIST, name: 'Skeptiker', template: 'critic' as const };
    const calls = stubApi(() => json(created, 201));
    const { onCreated, onDone, dialog } = renderEditor(null);
    expect(dialog).toHaveAccessibleName('Eigenen Agenten erstellen');
    expect(screen.getByRole('button', { name: 'Erstellen' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Vorlage'), { target: { value: 'critic' } });
    expect(screen.getByLabelText('Rolle')).toHaveValue('Schwachstellen und Risiken');
    expect(screen.getByLabelText<HTMLTextAreaElement>('Anweisungen').value).toMatch(
      /^Du suchst Schwachstellen/,
    );
    type('Name', 'Skeptiker');
    expect(dialog).toHaveTextContent('Erwähnt wird der Agent mit @Skeptiker.');
    type('Rolle', 'Hinterfragt alles');
    type('Anweisungen', 'Frag immer nach dem Beleg.');
    fireEvent.click(screen.getByRole('radio', { name: 'Rot' }));
    fireEvent.change(screen.getByLabelText('Modell'), { target: { value: 'claude-sonnet-5-5' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Darf auf dem Canvas zeichnen/ }));
    fireEvent.click(screen.getByRole('radio', { name: /Im Projekt geteilt/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Erstellen' }));

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledOnce();
    });
    expect(calls).toMatchObject([
      { method: 'POST', url: expect.stringMatching(/\/agents$/) as unknown },
    ]);
    expect(calls[0]?.body).toEqual({
      name: 'Skeptiker',
      role: 'Hinterfragt alles',
      instructions: 'Frag immer nach dem Beleg.',
      canDraw: false,
      model: 'claude-sonnet-5-5',
      color: 2,
      projectId: PROJECT.id,
      template: 'critic',
    });
    expect(onCreated).toHaveBeenCalledWith(created);
  });

  it('starts personal, with the given color, the default model and the right to draw', async () => {
    const calls = stubApi(() => json(JURIST, 201));
    renderEditor(null);
    expect(screen.getByRole('radio', { name: 'Stahlblau' })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Persönlich/ })).toBeChecked();
    expect(screen.getByLabelText('Modell')).toHaveValue('claude-opus-5-5');

    type('Name', 'Jurist');
    type('Rolle', 'Prüft Verträge');
    fireEvent.click(screen.getByRole('button', { name: 'Erstellen' }));

    await waitFor(() => {
      expect(calls).toHaveLength(1);
    });
    expect(calls[0]?.body).toEqual({
      name: 'Jurist',
      role: 'Prüft Verträge',
      instructions: '',
      canDraw: true,
      model: null,
      color: 4,
      projectId: null,
      template: null,
    });
  });

  it('explains a name that does not work before asking the server', () => {
    const calls = stubApi(() => json(JURIST, 201));
    renderEditor(null);
    type('Rolle', 'Prüft Verträge');

    type('Name', 'Backend');
    fireEvent.click(screen.getByRole('button', { name: 'Erstellen' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Auf diesen Namen hört schon ein Agent aus dem Katalog.',
    );
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');

    // Typing clears the error; the next problem is named when saving.
    type('Name', 'Zwei  Leerzeichen');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Erstellen' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Bitte 2 bis 24 Zeichen');
    expect(calls).toEqual([]);
  });

  it('says so when the name is taken or the limit is reached', async () => {
    let code = 'name_taken';
    stubApi(() => json({ error: { code, message: 'No' } }, 409));
    const { onDone } = renderEditor(null);
    type('Name', 'Jurist');
    type('Rolle', 'Prüft Verträge');

    fireEvent.click(screen.getByRole('button', { name: 'Erstellen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Du hast schon einen Agenten mit diesem Namen',
    );

    code = 'limit_reached';
    type('Name', 'Juristin');
    fireEvent.click(screen.getByRole('button', { name: 'Erstellen' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Mehr als 20 eigene Agenten gehen hier nicht.',
    );
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('AgentEditor: an existing agent', () => {
  it('offers no template and sends only what changed', async () => {
    const calls = stubApi(() => json({ ...JURIST, role: 'Prüft AGB' }));
    const { onDone, onCreated, dialog } = renderEditor(JURIST);
    expect(dialog).toHaveAccessibleName('Jurist bearbeiten');
    expect(screen.queryByLabelText('Vorlage')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Anweisungen')).toHaveValue('Nenne die Rechtsgrundlage.');
    expect(screen.getByRole('radio', { name: 'Rot' })).toBeChecked();

    type('Rolle', 'Prüft AGB');
    fireEvent.click(screen.getByRole('radio', { name: /Im Projekt geteilt/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledOnce();
    });
    expect(calls).toMatchObject([
      { method: 'PATCH', url: expect.stringContaining(`/agents/${JURIST.key}`) as unknown },
    ]);
    expect(calls[0]?.body).toEqual({ role: 'Prüft AGB', projectId: PROJECT.id });
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('closes without a request when nothing changed', async () => {
    const calls = stubApi(() => json(JURIST));
    const { onDone } = renderEditor(JURIST);

    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledOnce();
    });
    expect(calls).toEqual([]);
  });

  it('lets only the creator change who sees a shared agent', () => {
    stubApi(() => json(JURIST));
    const shared: CustomAgent = { ...JURIST, scope: 'project', projectId: PROJECT.id };
    renderEditor(shared, EDDIE);

    expect(screen.getByRole('radio', { name: /Im Projekt geteilt/ })).toBeChecked();
    expect(screen.getByRole('radio', { name: /Persönlich/ })).toBeDisabled();
    expect(screen.getByRole('dialog')).toHaveTextContent('Nur Olga kann die Sichtbarkeit ändern.');
    // Everything else is still theirs to edit.
    expect(screen.getByLabelText('Rolle')).toBeEnabled();
  });

  it('deletes after a second click', async () => {
    const calls = stubApi(() => new Response(null, { status: 204 }));
    const { onDone } = renderEditor(JURIST);

    fireEvent.click(screen.getByRole('button', { name: 'Löschen' }));
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Der Agent verlässt jedes Team. Seine Nachrichten bleiben.',
    );
    expect(calls).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'Endgültig löschen' }));

    await waitFor(() => {
      expect(onDone).toHaveBeenCalledOnce();
    });
    expect(calls).toMatchObject([
      { method: 'DELETE', url: expect.stringContaining(`/agents/${JURIST.key}`) as unknown },
    ]);
  });
});

describe('custom agents in the team menu', () => {
  const WRITER: CustomAgent = {
    ...JURIST,
    key: '44444444-4444-4444-8444-444444444444',
    name: 'UX Writer',
    role: 'Texte und Tonalität',
    color: 3,
    model: 'claude-haiku-4-5-20251001',
    scope: 'project',
    projectId: PROJECT.id,
    ownerId: EDDIE,
    ownerName: 'Eddie',
  };
  /** A personal agent of someone else that is in the team: known by the directory only. */
  const GUEST = {
    key: '55555555-5555-4555-8555-555555555555',
    name: 'Gast',
    role: 'Zu Besuch',
    color: 6,
    model: null,
    canDraw: true,
    scope: 'personal' as const,
    ownerId: EDDIE,
    ownerName: 'Eddie',
    deleted: false,
  };

  function renderMenu({ canEdit = true } = {}) {
    const handlers = {
      onAdd: vi.fn(),
      onRemove: vi.fn(),
      onModelChange: vi.fn(),
      onCreateAgent: vi.fn(),
      onEditAgent: vi.fn(),
    };
    render(
      <TooltipProvider>
        <AgentDirectoryProvider agents={[WRITER, GUEST]}>
          <TeamMenu
            agents={[
              { key: 'moderator', model: null },
              { key: GUEST.key, model: null },
              { key: WRITER.key, model: null },
            ]}
            canEdit={canEdit}
            canChooseModel={false}
            customAgents={canEdit ? [JURIST, WRITER] : undefined}
            userId={OLGA}
            {...handlers}
            onCreateAgent={canEdit ? handlers.onCreateAgent : undefined}
          />
        </AgentDirectoryProvider>
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Team: Moderator, Gast, UX Writer' }));
    return { ...handlers, popover: screen.getByRole('dialog', { name: 'Team' }) };
  }

  it('show in the team with their initials, role, scope and own default model', () => {
    const { popover } = renderMenu();

    expect(popover).toHaveTextContent('UX WriterTexte und Tonalität · GeteiltHaiku 4.5');
    expect(popover).toHaveTextContent('GastZu Besuch · PersönlichOpus 5.5');
    expect(within(popover).getAllByRole('img', { name: 'UX Writer' })[0]).toHaveTextContent('UW');
    expect(within(popover).getByLabelText('Modell von UX Writer: Haiku 4.5')).toBeInTheDocument();
  });

  it('can be added, edited and removed by those who may', () => {
    const { popover, onAdd, onEditAgent, onRemove, onCreateAgent } = renderMenu();

    // The user's personal agent is offered after the catalog agents.
    const offered = within(popover)
      .getAllByRole('button', { name: /hinzufügen$/ })
      .map((button) => button.getAttribute('aria-label'));
    expect(offered.at(-1)).toBe('Jurist hinzufügen');
    expect(offered).toHaveLength(10);
    fireEvent.click(within(popover).getByRole('button', { name: 'Jurist hinzufügen' }));
    expect(onAdd).toHaveBeenCalledWith(JURIST.key);

    // Own personal agents and shared agents can be edited, someone else's personal agent not.
    expect(within(popover).queryByRole('button', { name: 'Gast bearbeiten' })).toBeNull();
    fireEvent.click(within(popover).getByRole('button', { name: 'Gast aus dem Team entfernen' }));
    expect(onRemove).toHaveBeenCalledWith(GUEST.key);
    fireEvent.click(within(popover).getByRole('button', { name: 'UX Writer bearbeiten' }));
    expect(onEditAgent).toHaveBeenCalledWith(WRITER);
    // The popover made room for the editor.
    expect(screen.queryByRole('dialog', { name: 'Team' })).not.toBeInTheDocument();
    expect(onCreateAgent).not.toHaveBeenCalled();
  });

  it('are created from the team menu', () => {
    const { popover, onCreateAgent } = renderMenu();
    fireEvent.click(within(popover).getByRole('button', { name: 'Eigenen Agenten erstellen' }));
    expect(onCreateAgent).toHaveBeenCalledOnce();
  });

  it('are only shown to viewers', () => {
    const { popover } = renderMenu({ canEdit: false });
    expect(popover).toHaveTextContent('UX WriterTexte und Tonalität · Geteilt');
    expect(within(popover).queryAllByRole('button')).toEqual([]);
  });
});
