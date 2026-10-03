import type { CodingPackageOverview } from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Dialog } from '@web/components/ui/dialog';
import { downloadBlob } from '@web/features/export/download';
import { PackageDialog } from '@web/features/export/package-dialog';

// The browser's downloads are replaced; what goes into them is checked.
vi.mock('@web/features/export/download', () => ({ downloadBlob: vi.fn(), downloadText: vi.fn() }));

const PROJECT_ID = '7b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const BASE = `/api/projects/${PROJECT_ID}/package`;

const OVERVIEW: CodingPackageOverview = {
  hasPlan: true,
  milestones: 2,
  tasks: 3,
  milestoneSpecs: [
    { number: 1, title: 'Grundgerüst', tasks: 2, written: 0, run: null },
    { number: 2, title: 'Mitglieder', tasks: 1, written: 0, run: null },
  ],
  decisions: { decided: 4, open: 1 },
  diagrams: 1,
  files: ['CLAUDE.md', 'AGENTS.md', 'context/project-plan.md', 'docs/diagrams/haupt-canvas.md'],
  language: 'de',
  texts: { code_standards: 'TypeScript strict.', ui_direction: '' },
  suggestions: { code_standards: null, ui_direction: null },
  canEdit: true,
};

const SUGGESTED = '## Stil\n\n- Ruhig und hell';

type Call = { method: string; url: string; body: unknown };

/**
 * Answers the package's API: the overview given, "no content" for a stored text and a ZIP for the
 * download; a suggestion is asked for, taken over with its text and dismissed. `fail` names the
 * calls that fail instead, `running` the ones the server refuses because a run is on its way.
 */
function stubPackage(overview: CodingPackageOverview, fail: string[] = [], running: string[] = []) {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      const method = init?.method ?? 'GET';
      const key = `${method} ${url}`;
      calls.push({
        method,
        url,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      });
      if (fail.includes(key)) {
        return Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'internal', message: 'Broken.' } }), {
            status: 500,
          }),
        );
      }
      if (running.includes(key)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({ error: { code: 'already_running', message: 'Running.' } }),
            { status: 409 },
          ),
        );
      }
      if (key === `GET ${BASE}`) return Promise.resolve(Response.json(overview));
      if (method === 'PUT') return Promise.resolve(new Response(null, { status: 204 }));
      if (method === 'DELETE') return Promise.resolve(new Response(null, { status: 204 }));
      if (method === 'POST' && (url.endsWith('/suggestion') || url.includes('/specs/'))) {
        return Promise.resolve(new Response(null, { status: 202 }));
      }
      if (method === 'POST' && url.endsWith('/suggestion/accept')) {
        return Promise.resolve(Response.json({ content: SUGGESTED }));
      }
      if (key === `GET ${BASE}/download`) {
        return Promise.resolve(
          new Response(new Blob(['PK'], { type: 'application/zip' }), {
            headers: {
              'content-type': 'application/zip',
              'content-disposition': 'attachment; filename="vereins-app-coding-paket.zip"',
            },
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }),
  );
  return calls;
}

function renderDialog(
  overview: Partial<CodingPackageOverview> = {},
  { outdated = false, fail = [] as string[], running = [] as string[] } = {},
) {
  const calls = stubPackage({ ...OVERVIEW, ...overview }, fail, running);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const { unmount } = render(
    <QueryClientProvider client={queryClient}>
      <Dialog open>
        <PackageDialog projectId={PROJECT_ID} outdated={outdated} />
      </Dialog>
    </QueryClientProvider>,
  );
  const dialog = screen.getByRole('dialog', { name: 'Paket für Coding-Agents' });
  return { calls, dialog, unmount };
}

/** The lines of what the package holds: their text and whether they are there or missing. */
async function rows(dialog: HTMLElement) {
  const list = within(await within(dialog).findByRole('region', { name: 'Im Paket' })).getByRole(
    'list',
  );
  return within(list)
    .getAllByRole('listitem')
    .map((item) => `${item.dataset.done === 'true' ? '✓' : '○'} ${item.textContent}`);
}

const puts = (calls: Call[]) => calls.filter((call) => call.method === 'PUT');

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PackageDialog', () => {
  it('shows what the package holds and what is missing', async () => {
    const { dialog } = renderDialog();

    expect(await rows(dialog)).toEqual([
      '✓ Projektplan',
      '✓ 3 Feature-Specs · 2 Meilensteine',
      '○ 4 Entscheidungen · 1 Thema noch offen',
      '✓ Diagramme von 1 Board',
      '✓ Code-Standards',
      '○ UI-Richtung fehlt noch.',
    ]);
    expect(within(dialog).getByLabelText('Code-Standards')).toHaveValue('TypeScript strict.');
    expect(within(dialog).getByLabelText('UI-Richtung')).toHaveValue('');
    expect(within(dialog).getByRole('button', { name: 'Paket herunterladen' })).toBeEnabled();
  });

  it('lists the files of the package', async () => {
    const { dialog } = renderDialog();

    const summary = await within(dialog).findByText('4 Dateien anzeigen');
    const files = within(summary.closest('details') ?? dialog).getAllByRole('listitem');

    expect(files.map((file) => file.textContent)).toEqual(OVERVIEW.files);
  });

  it('says what a project without tasks, decisions and diagrams lacks', async () => {
    const { dialog } = renderDialog({
      milestones: 0,
      tasks: 0,
      decisions: { decided: 0, open: 0 },
      diagrams: 0,
      texts: { code_standards: '', ui_direction: 'Ruhig und hell.' },
    });

    expect(await rows(dialog)).toEqual([
      '✓ Projektplan',
      '○ Der Plan nennt keine Aufgaben, also gibt es keine Feature-Specs.',
      '○ Keine Entscheidungen festgehalten.',
      '○ Keine Diagramme auf den Boards.',
      '○ Code-Standards fehlen noch.',
      '✓ UI-Richtung',
    ]);
  });

  it('says that the plan is outdated', async () => {
    const { dialog } = renderDialog({}, { outdated: true });

    expect((await rows(dialog))[0]).toBe(
      '○ Der Projektplan ist veraltet. Aktualisiere ihn am besten vor dem Export.',
    );
    expect(within(dialog).getByRole('button', { name: 'Paket herunterladen' })).toBeEnabled();
  });

  it('offers no download without a plan', async () => {
    const { dialog } = renderDialog({ hasPlan: false, milestones: 0, tasks: 0, files: [] });

    expect((await rows(dialog))[0]).toBe('○ Noch kein Projektplan. Ohne Plan gibt es kein Paket.');
    expect(within(dialog).getByRole('button', { name: 'Paket herunterladen' })).toBeDisabled();
    expect(within(dialog).queryByText(/Dateien anzeigen/)).not.toBeInTheDocument();
  });

  it('stores a text when its field is left, and counts it as given', async () => {
    const { calls, dialog } = renderDialog();
    const field = await within(dialog).findByLabelText('UI-Richtung');

    fireEvent.change(field, { target: { value: '  Ruhig und hell.\n' } });
    fireEvent.blur(field);

    expect(await within(dialog).findByText('Gespeichert')).toBeInTheDocument();
    expect(puts(calls)).toEqual([
      {
        method: 'PUT',
        url: `${BASE}/texts/ui_direction`,
        body: { content: 'Ruhig und hell.' },
      },
    ]);
    expect((await rows(dialog)).at(-1)).toBe('✓ UI-Richtung');
  });

  it('stores nothing when a field is left as it was', async () => {
    const { calls, dialog } = renderDialog();
    const field = await within(dialog).findByLabelText('Code-Standards');

    fireEvent.change(field, { target: { value: 'TypeScript strict. ' } });
    fireEvent.blur(field);
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Paket herunterladen' })).toBeEnabled();
    });

    expect(puts(calls)).toEqual([]);
    expect(within(dialog).queryByText('Gespeichert')).not.toBeInTheDocument();
  });

  it('stores what a field shows when the dialog closes before the field is left', async () => {
    const { calls, dialog, unmount } = renderDialog();
    const field = await within(dialog).findByLabelText('UI-Richtung');

    fireEvent.change(field, { target: { value: 'Ruhig und hell.' } });
    unmount();

    await waitFor(() => {
      expect(puts(calls)).toEqual([
        {
          method: 'PUT',
          url: `${BASE}/texts/ui_direction`,
          body: { content: 'Ruhig und hell.' },
        },
      ]);
    });
  });

  it('stores nothing when the dialog closes with its fields as they were', async () => {
    const { calls, dialog, unmount } = renderDialog();
    const field = await within(dialog).findByLabelText('UI-Richtung');

    fireEvent.change(field, { target: { value: 'Ruhig und hell.' } });
    fireEvent.blur(field);
    await within(dialog).findByText('Gespeichert');
    unmount();
    await Promise.resolve();

    expect(puts(calls)).toHaveLength(1);
  });

  it('removes a text that is emptied', async () => {
    const { calls, dialog } = renderDialog();
    const field = await within(dialog).findByLabelText('Code-Standards');

    fireEvent.change(field, { target: { value: '' } });
    fireEvent.blur(field);

    await within(dialog).findByText('Gespeichert');
    expect(puts(calls)).toEqual([
      { method: 'PUT', url: `${BASE}/texts/code_standards`, body: { content: '' } },
    ]);
    expect(await rows(dialog)).toContain('○ Code-Standards fehlen noch.');
  });

  it('downloads the package under the name the server gives it', async () => {
    const { calls, dialog } = renderDialog();

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Paket herunterladen' }));

    await waitFor(() => {
      expect(downloadBlob).toHaveBeenCalledTimes(1);
    });
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'vereins-app-coding-paket.zip');
    expect(puts(calls)).toEqual([]);
  });

  it('stores what the fields show before it downloads', async () => {
    const { calls, dialog } = renderDialog();
    const field = await within(dialog).findByLabelText('UI-Richtung');

    // The field is never left: the download asks for the package right away.
    fireEvent.change(field, { target: { value: 'Ruhig und hell.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Paket herunterladen' }));

    await waitFor(() => {
      expect(downloadBlob).toHaveBeenCalledTimes(1);
    });
    const order = calls.map((call) => `${call.method} ${call.url}`);
    expect(order.indexOf(`PUT ${BASE}/texts/ui_direction`)).toBeGreaterThan(-1);
    expect(order.indexOf(`PUT ${BASE}/texts/ui_direction`)).toBeLessThan(
      order.indexOf(`GET ${BASE}/download`),
    );
    expect(puts(calls)).toHaveLength(1);
  });

  it('downloads nothing while a text could not be stored', async () => {
    const { calls, dialog } = renderDialog({}, { fail: [`PUT ${BASE}/texts/ui_direction`] });
    const field = await within(dialog).findByLabelText('UI-Richtung');

    fireEvent.change(field, { target: { value: 'Ruhig und hell.' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Paket herunterladen' }));

    expect(await within(dialog).findByText('Nicht gespeichert')).toBeInTheDocument();
    await waitFor(() => {
      expect(within(dialog).getByRole('button', { name: 'Paket herunterladen' })).toBeEnabled();
    });
    expect(calls.some((call) => call.url === `${BASE}/download`)).toBe(false);
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('tells when the download did not work', async () => {
    const { dialog } = renderDialog({}, { fail: [`GET ${BASE}/download`] });

    fireEvent.click(await within(dialog).findByRole('button', { name: 'Paket herunterladen' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Der Export hat nicht geklappt.',
    );
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('lets viewers read the texts and download, but not write', async () => {
    const { calls, dialog } = renderDialog({ canEdit: false });
    const field = await within(dialog).findByLabelText('Code-Standards');

    expect(field).toHaveAttribute('readonly');
    expect(within(dialog).getByLabelText('UI-Richtung')).toHaveAttribute(
      'placeholder',
      'Noch nichts festgelegt.',
    );
    expect(within(dialog).getByText('Owner und Bearbeiter schreiben diese Texte.')).toBeVisible();
    fireEvent.blur(field);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Paket herunterladen' }));

    await waitFor(() => {
      expect(downloadBlob).toHaveBeenCalledTimes(1);
    });
    expect(puts(calls)).toEqual([]);
  });

  it('tells when the package could not be loaded', async () => {
    const { dialog } = renderDialog({}, { fail: [`GET ${BASE}`] });

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Das Paket konnte nicht geladen werden.',
    );
    expect(within(dialog).queryByRole('button', { name: 'Paket herunterladen' })).toBeNull();
  });
});

describe('the moderator’s suggestions in the PackageDialog (spec 27c)', () => {
  const UI = `${BASE}/texts/ui_direction/suggestion`;
  const ready = { status: 'ready', content: SUGGESTED } as const;
  const asks = (dialog: HTMLElement) =>
    within(dialog).queryAllByRole('button', { name: 'Vorschlag vom Moderator' });
  const others = (calls: Call[]) =>
    calls.filter((call) => call.method !== 'GET').map((call) => `${call.method} ${call.url}`);

  it('asks the moderator for a text and says that it writes', async () => {
    const { calls, dialog } = renderDialog();
    await within(dialog).findByLabelText('UI-Richtung');
    expect(asks(dialog)).toHaveLength(2);

    // The second button belongs to the second field, the UI direction.
    fireEvent.click(asks(dialog)[1] as HTMLElement);

    expect(
      await within(dialog).findByText(
        'Der Moderator schreibt einen Vorschlag … Das dauert etwa eine Minute.',
      ),
    ).toBeInTheDocument();
    expect(others(calls)).toEqual([`POST ${UI}`]);
    // While it writes, it cannot be asked again for the same text.
    expect(asks(dialog)).toHaveLength(1);
    expect(within(dialog).getByLabelText('UI-Richtung')).toHaveValue('');
  });

  it('shows that the moderator writes after the dialog was opened again, and lets it be stopped', async () => {
    const { calls, dialog } = renderDialog({
      suggestions: { code_standards: null, ui_direction: { status: 'running' } },
    });

    expect(await within(dialog).findByText(/Der Moderator schreibt einen Vorschlag/)).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Abbrechen' }));

    await waitFor(() => {
      expect(
        within(dialog).queryByText(/Der Moderator schreibt einen Vorschlag/),
      ).not.toBeInTheDocument();
    });
    expect(others(calls)).toEqual([`DELETE ${UI}`]);
    expect(asks(dialog)).toHaveLength(2);
  });

  it('shows a suggestion below its field and takes it over into the field', async () => {
    const { calls, dialog } = renderDialog({
      suggestions: { code_standards: null, ui_direction: ready },
    });
    const suggestion = await within(dialog).findByRole('region', {
      name: 'Vorschlag des Moderators: UI-Richtung',
    });
    expect(suggestion).toHaveTextContent('Moderator· Vorschlag');
    expect(suggestion).toHaveTextContent('- Ruhig und hell');
    // The field is empty: nothing is replaced.
    expect(within(suggestion).queryByText('Ersetzt den Text im Feld.')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('UI-Richtung')).toHaveValue('');

    fireEvent.click(within(suggestion).getByRole('button', { name: 'Übernehmen' }));

    await waitFor(() => {
      expect(within(dialog).getByLabelText('UI-Richtung')).toHaveValue(SUGGESTED);
    });
    expect(suggestion).not.toBeInTheDocument();
    expect(within(dialog).getByText('Gespeichert')).toBeInTheDocument();
    expect((await rows(dialog)).at(-1)).toBe('✓ UI-Richtung');
    expect(others(calls)).toEqual([`POST ${UI}/accept`]);
    // The text is the server's already: leaving the field stores nothing more.
    fireEvent.blur(within(dialog).getByLabelText('UI-Richtung'));
    await waitFor(() => {
      expect(asks(dialog)).toHaveLength(2);
    });
    expect(puts(calls)).toEqual([]);
  });

  it('says that taking a suggestion over replaces the text of the field', async () => {
    const { dialog } = renderDialog({
      suggestions: { code_standards: ready, ui_direction: null },
    });
    const suggestion = await within(dialog).findByRole('region', {
      name: 'Vorschlag des Moderators: Code-Standards',
    });

    expect(within(suggestion).getByText('Ersetzt den Text im Feld.')).toBeVisible();
    fireEvent.click(within(suggestion).getByRole('button', { name: 'Übernehmen' }));

    await waitFor(() => {
      expect(within(dialog).getByLabelText('Code-Standards')).toHaveValue(SUGGESTED);
    });
  });

  it('dismisses a suggestion and leaves the field as it is', async () => {
    const { calls, dialog } = renderDialog({
      suggestions: { code_standards: ready, ui_direction: null },
    });
    const suggestion = await within(dialog).findByRole('region', {
      name: 'Vorschlag des Moderators: Code-Standards',
    });

    fireEvent.click(within(suggestion).getByRole('button', { name: 'Verwerfen' }));

    await waitFor(() => {
      expect(suggestion).not.toBeInTheDocument();
    });
    expect(others(calls)).toEqual([`DELETE ${BASE}/texts/code_standards/suggestion`]);
    expect(within(dialog).getByLabelText('Code-Standards')).toHaveValue('TypeScript strict.');
    expect(asks(dialog)).toHaveLength(2);
  });

  it('says why a run gave nothing, and lets the moderator be asked again', async () => {
    const { calls, dialog } = renderDialog({
      suggestions: {
        code_standards: { status: 'failed', failure: { kind: 'failed', resetsAt: null } },
        ui_direction: {
          status: 'failed',
          failure: { kind: 'quota', resetsAt: '2026-10-03T20:30:00.000Z' },
        },
      },
    });

    const alerts = await within(dialog).findAllByRole('alert');
    expect(alerts[0]).toHaveTextContent(
      'Der Vorschlag hat nicht geklappt. Bitte versuche es noch einmal.',
    );
    expect(alerts[1]).toHaveTextContent(
      /^Das KI-Kontingent ist gerade aufgebraucht und ab \d{1,2}:\d{2}(\sUhr)? wieder frei\.$/,
    );
    // Asking again is offered for both.
    expect(asks(dialog)).toHaveLength(2);

    fireEvent.click(asks(dialog)[0] as HTMLElement);

    await waitFor(() => {
      expect(within(dialog).getAllByRole('alert')).toHaveLength(1);
    });
    expect(within(dialog).getByText(/Der Moderator schreibt einen Vorschlag/)).toBeVisible();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Ausblenden' }));
    await waitFor(() => {
      expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    });
    expect(others(calls)).toEqual([`POST ${BASE}/texts/code_standards/suggestion`, `DELETE ${UI}`]);
  });

  it('tells when the moderator could not be asked, but not when it writes already', async () => {
    const failing = renderDialog({}, { fail: [`POST ${UI}`] });
    await within(failing.dialog).findByLabelText('UI-Richtung');
    fireEvent.click(asks(failing.dialog)[1] as HTMLElement);

    expect(await within(failing.dialog).findByRole('alert')).toHaveTextContent(
      'Der Vorschlag hat nicht geklappt.',
    );
    failing.unmount();

    // Someone else asked in the same moment: the overview is loaded again and says what is true.
    const taken = renderDialog({}, { running: [`POST ${UI}`] });
    await within(taken.dialog).findByLabelText('UI-Richtung');
    fireEvent.click(asks(taken.dialog)[1] as HTMLElement);

    await waitFor(() => {
      expect(taken.calls.filter((call) => call.url === BASE)).toHaveLength(2);
    });
    expect(within(taken.dialog).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('tells when a suggestion could not be taken over, and keeps the field', async () => {
    const { dialog } = renderDialog(
      { suggestions: { code_standards: ready, ui_direction: null } },
      { fail: [`POST ${BASE}/texts/code_standards/suggestion/accept`] },
    );
    const suggestion = await within(dialog).findByRole('region', {
      name: 'Vorschlag des Moderators: Code-Standards',
    });

    fireEvent.click(within(suggestion).getByRole('button', { name: 'Übernehmen' }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Der Vorschlag hat nicht geklappt.',
    );
    expect(within(dialog).getByLabelText('Code-Standards')).toHaveValue('TypeScript strict.');
  });

  it('shows viewers a suggestion without anything to click', async () => {
    const { dialog } = renderDialog({
      canEdit: false,
      suggestions: { code_standards: ready, ui_direction: { status: 'running' } },
    });
    const suggestion = await within(dialog).findByRole('region', {
      name: 'Vorschlag des Moderators: Code-Standards',
    });

    expect(within(suggestion).queryByRole('button')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Der Moderator schreibt einen Vorschlag/)).toBeVisible();
    expect(within(dialog).queryByRole('button', { name: 'Abbrechen' })).not.toBeInTheDocument();
    expect(asks(dialog)).toHaveLength(0);
  });
});

describe('the feature specs in the PackageDialog (spec 27d)', () => {
  const SPECS = `${BASE}/specs`;
  const posts = (calls: Call[]) =>
    calls.filter((call) => call.method === 'POST').map((call) => call.url);

  /** The lines of the section: the milestone, how far it is, and what can be done or goes on. */
  async function milestones(dialog: HTMLElement) {
    const section = await within(dialog).findByRole('region', { name: 'Feature-Specs' });
    return within(section)
      .getAllByRole('listitem')
      .map((item) => item.textContent);
  }

  it('lists the milestones with how many specs are written out', async () => {
    const { dialog } = renderDialog({
      milestoneSpecs: [
        { number: 1, title: 'Grundgerüst', tasks: 2, written: 2, run: null },
        { number: 2, title: '', tasks: 3, written: 1, run: null },
        { number: 3, title: 'Abschluss', tasks: 0, written: 0, run: null },
      ],
    });

    expect(await milestones(dialog)).toEqual([
      'Meilenstein 1: Grundgerüst2 von 2 ausgearbeitetNeu ausarbeiten',
      // A milestone without a name is called by its number.
      'Meilenstein 21 von 3 ausgearbeitetAusarbeiten',
      // Nothing to write for a milestone without tasks.
      'Meilenstein 3: AbschlussKeine Aufgaben',
    ]);
    expect((await rows(dialog))[1]).toBe('✓ 3 Feature-Specs · 2 Meilensteine · 3 ausgearbeitet');
  });

  it('has the moderator write the specs of a milestone out, and says that it writes', async () => {
    const { calls, dialog } = renderDialog();
    const section = await within(dialog).findByRole('region', { name: 'Feature-Specs' });

    fireEvent.click(
      within(section).getAllByRole('button', { name: 'Ausarbeiten' })[1] as HTMLElement,
    );

    expect(await within(section).findByText('Der Moderator schreibt …')).toBeInTheDocument();
    expect(posts(calls)).toEqual([`${SPECS}/2`]);
    expect(await milestones(dialog)).toEqual([
      'Meilenstein 1: Grundgerüst0 von 2 ausgearbeitetAusarbeiten',
      'Meilenstein 2: Mitglieder0 von 1 ausgearbeitetMDer Moderator schreibt …',
    ]);
  });

  it('stores what the fields show before the moderator reads them', async () => {
    const { calls, dialog } = renderDialog();
    const field = await within(dialog).findByLabelText('UI-Richtung');
    const section = within(dialog).getByRole('region', { name: 'Feature-Specs' });

    // The field is never left.
    fireEvent.change(field, { target: { value: 'Ruhig und hell.' } });
    fireEvent.click(
      within(section).getAllByRole('button', { name: 'Ausarbeiten' })[0] as HTMLElement,
    );

    await within(section).findByText('Der Moderator schreibt …');
    const order = calls.map((call) => `${call.method} ${call.url}`);
    expect(order.indexOf(`PUT ${BASE}/texts/ui_direction`)).toBeGreaterThan(-1);
    expect(order.indexOf(`PUT ${BASE}/texts/ui_direction`)).toBeLessThan(
      order.indexOf(`POST ${SPECS}/1`),
    );
  });

  it('shows a run that is on its way or failed after the dialog was opened again', async () => {
    const { dialog } = renderDialog({
      milestoneSpecs: [
        { number: 1, title: 'Grundgerüst', tasks: 2, written: 0, run: { status: 'running' } },
        {
          number: 2,
          title: 'Mitglieder',
          tasks: 1,
          written: 0,
          run: { status: 'failed', failure: { kind: 'failed', resetsAt: null } },
        },
      ],
    });

    expect(await milestones(dialog)).toEqual([
      'Meilenstein 1: Grundgerüst0 von 2 ausgearbeitetMDer Moderator schreibt …',
      // A failed run can be asked for again.
      'Meilenstein 2: Mitglieder0 von 1 ausgearbeitetAusarbeitenDie Specs konnten nicht ausgearbeitet werden. Bitte versuche es noch einmal.',
    ]);
  });

  it('says when the quota is used up, with the time it is free again', async () => {
    const { dialog } = renderDialog({
      milestoneSpecs: [
        {
          number: 1,
          title: 'Grundgerüst',
          tasks: 2,
          written: 0,
          run: {
            status: 'failed',
            failure: { kind: 'quota', resetsAt: '2026-10-03T20:30:00.000Z' },
          },
        },
      ],
    });
    const section = await within(dialog).findByRole('region', { name: 'Feature-Specs' });

    expect(within(section).getByRole('alert')).toHaveTextContent(
      /^Das KI-Kontingent ist gerade aufgebraucht und ab \d{1,2}:\d{2}(\sUhr)? wieder frei\.$/,
    );
  });

  it('tells when the moderator could not be asked, but not when it writes already', async () => {
    const failing = renderDialog({}, { fail: [`POST ${SPECS}/1`] });
    const section = await within(failing.dialog).findByRole('region', { name: 'Feature-Specs' });
    fireEvent.click(
      within(section).getAllByRole('button', { name: 'Ausarbeiten' })[0] as HTMLElement,
    );

    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'Die Specs konnten nicht ausgearbeitet werden.',
    );
    failing.unmount();

    // Someone else asked in the same moment: the overview is loaded again and says what is true.
    const taken = renderDialog({}, { running: [`POST ${SPECS}/1`] });
    const again = await within(taken.dialog).findByRole('region', { name: 'Feature-Specs' });
    fireEvent.click(
      within(again).getAllByRole('button', { name: 'Ausarbeiten' })[0] as HTMLElement,
    );

    await waitFor(() => {
      expect(taken.calls.filter((call) => call.url === BASE)).toHaveLength(2);
    });
    expect(within(again).queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows viewers how far the specs are, without a button', async () => {
    const { dialog } = renderDialog({
      canEdit: false,
      milestoneSpecs: [{ number: 1, title: 'Grundgerüst', tasks: 2, written: 1, run: null }],
    });
    const section = await within(dialog).findByRole('region', { name: 'Feature-Specs' });

    expect(within(section).getByText('1 von 2 ausgearbeitet')).toBeVisible();
    expect(within(section).queryByRole('button')).not.toBeInTheDocument();
  });

  it('has no section for a plan without milestones', async () => {
    const { dialog } = renderDialog({ milestones: 0, tasks: 0, milestoneSpecs: [] });
    await within(dialog).findByLabelText('UI-Richtung');

    expect(within(dialog).queryByRole('region', { name: 'Feature-Specs' })).not.toBeInTheDocument();
  });
});
