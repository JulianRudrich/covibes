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
  decisions: { decided: 4, open: 1 },
  diagrams: 1,
  files: ['CLAUDE.md', 'AGENTS.md', 'context/project-plan.md', 'docs/diagrams/haupt-canvas.md'],
  language: 'de',
  texts: { code_standards: 'TypeScript strict.', ui_direction: '' },
  canEdit: true,
};

type Call = { method: string; url: string; body: unknown };

/**
 * Answers the package's API: the overview given, "no content" for a stored text and a ZIP for the
 * download. `fail` names the calls that fail instead.
 */
function stubPackage(overview: CodingPackageOverview, fail: string[] = []) {
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
      if (key === `GET ${BASE}`) return Promise.resolve(Response.json(overview));
      if (method === 'PUT') return Promise.resolve(new Response(null, { status: 204 }));
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
  { outdated = false, fail = [] as string[] } = {},
) {
  const calls = stubPackage({ ...OVERVIEW, ...overview }, fail);
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
