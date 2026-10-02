import {
  planNodesFromMarkdown,
  type PlanNode,
  type PlanVersion,
  type PlanVersionContent,
} from '@covibes/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PlanVersions } from '@web/features/plan/plan-versions';
import { createQueryClient } from '@web/lib/query-client';
import { stubApi } from '@web/test-utils';

const PROJECT = '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const URL = `/api/projects/${PROJECT}/plan/versions`;

const version = (number: number, reason: PlanVersion['reason']): PlanVersion => ({
  id: `0000000${String(number)}-0000-4000-8000-000000000000`,
  number,
  reason,
  createdAt: new Date(Date.now() - (4 - number) * 60 * 60_000).toISOString(),
  createdBy: number === 1 ? null : 'Olga',
});

const VERSIONS = [version(3, 'updated'), version(2, 'generated'), version(1, 'manual')];
const TEXTS: Record<number, string> = {
  1: '## MVP-Umfang\n\nVon Hand geschrieben',
  2: '## MVP-Umfang\n\nMitgliederliste\n\n## Tech-Empfehlung\n\nEigener Server',
  3: '## MVP-Umfang\n\nMitgliederliste\n\n## Tech-Empfehlung\n\nVerwalteter Dienst',
};

/** The plan with its section headings, as the server stores a version. */
function planOf(markdown: string): PlanNode[] {
  return planNodesFromMarkdown(markdown).map((node) =>
    node.type === 'heading' ? { ...node, attrs: { level: 2 } } : node,
  );
}

function renderVersions(versions: PlanVersion[] = VERSIONS) {
  const api = stubApi({
    [`GET ${URL}`]: () => ({ body: versions }),
    ...Object.fromEntries(
      versions.map((entry) => [
        `GET ${URL}/${entry.id}`,
        () => ({
          body: {
            ...entry,
            content: planOf(TEXTS[entry.number] ?? ''),
          } satisfies PlanVersionContent,
        }),
      ]),
    ),
  });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <PlanVersions
        projectId={PROJECT}
        current={planOf(
          '## MVP-Umfang\n\nMitgliederliste und Beiträge\n\n## Tech-Empfehlung\n\nVerwalteter Dienst',
        )}
      />
    </QueryClientProvider>,
  );
  return api;
}

const diffLines = (dialog: HTMLElement) =>
  [...dialog.querySelectorAll('.bg-danger-bg, .bg-success-bg')].map((line) => line.textContent);

describe('PlanVersions', () => {
  it('lists the versions, newest first, and compares the newest with the plan as it stands', async () => {
    renderVersions();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Versionen' }));

    const dialog = await screen.findByRole('dialog', { name: 'Versionen des Plans' });
    const list = await within(dialog).findByRole('list', { name: 'Versionen' });
    expect(
      within(list)
        .getAllByRole('button')
        .map((entry) => entry.textContent),
    ).toEqual([
      expect.stringMatching(/^Version 3Nach der Aktualisierung.+ · Olga$/),
      expect.stringMatching(/^Version 2Nach dem Erzeugen.+ · Olga$/),
      expect.stringMatching(/^Version 1Von Hand geändertvor 3 Stunden$/),
    ]);
    expect(within(list).getByRole('button', { name: /Version 3/ })).toHaveAttribute(
      'aria-current',
      'true',
    );

    // What changed in the plan since version 3.
    await waitFor(() => {
      expect(diffLines(dialog)).toEqual([
        'entfällt: Mitgliederliste',
        'neu: Mitgliederliste und Beiträge',
      ]);
    });
  });

  it('compares a version with the one before it and shows its text', async () => {
    renderVersions();
    fireEvent.click(screen.getByRole('button', { name: 'Versionen' }));
    const dialog = await screen.findByRole('dialog', { name: 'Versionen des Plans' });
    await within(dialog).findByRole('list', { name: 'Versionen' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Änderungen gegenüber Version 2' }));
    await waitFor(() => {
      expect(diffLines(dialog)).toEqual(['entfällt: Eigener Server', 'neu: Verwalteter Dienst']);
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Inhalt' }));
    // The dialog has a heading of its own; these are the sections of the version.
    expect(
      [...dialog.querySelectorAll('.plan-doc-preview h2')].map((heading) => heading.textContent),
    ).toEqual(['MVP-Umfang', 'Tech-Empfehlung']);
    expect(within(dialog).getByText('Verwalteter Dienst').tagName).toBe('P');

    // The first version has none before it; it is compared with the plan instead.
    fireEvent.click(within(dialog).getByRole('button', { name: /Version 1/ }));
    expect(await within(dialog).findByText('Von Hand geschrieben')).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: /Änderungen gegenüber Version/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Änderungen seit dieser Version' }));
    expect(diffLines(dialog)).toEqual([
      'entfällt: Von Hand geschrieben',
      'neu: Mitgliederliste und Beiträge',
      'neu: ## Tech-Empfehlung',
      'neu: Verwalteter Dienst',
    ]);
  });

  it('says so while no version was kept yet', async () => {
    renderVersions([]);
    fireEvent.click(screen.getByRole('button', { name: 'Versionen' }));

    const dialog = await screen.findByRole('dialog', { name: 'Versionen des Plans' });
    expect(await within(dialog).findByText(/Noch keine Versionen\./)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schließen' }));
  });
});
