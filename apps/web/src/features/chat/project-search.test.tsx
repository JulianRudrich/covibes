import type { ProjectSearchResult } from '@covibes/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ProjectSearchButton,
  ProjectSearchPanel,
  ProjectSearchRow,
} from '@web/features/chat/project-search';

const RESULTS: ProjectSearchResult[] = [
  {
    kind: 'decision',
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Server hosting',
    snippet: 'Our own server or managed hosting',
  },
  {
    kind: 'block',
    id: '00000000-0000-4000-8000-000000000002',
    boardId: '00000000-0000-4000-8000-000000000003',
    title: 'AI gateway',
    snippet: '',
  },
];

function stubSearch(response: () => Response | Promise<Response>) {
  const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(response()));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** The header button and the panel as the chat wires them, with the focus returning on close. */
function SearchHarness({ onOpen }: { onOpen: (result: ProjectSearchResult) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ProjectSearchButton
        open={open}
        onClick={() => {
          setOpen(!open);
        }}
      />
      {open ? (
        <ProjectSearchPanel
          projectId="project-1"
          onOpen={onOpen}
          onClose={() => {
            setOpen(false);
            screen.getByRole('button', { name: 'Projekt durchsuchen' }).focus();
          }}
        />
      ) : null}
    </>
  );
}

function openSearch() {
  const onOpen = vi.fn<(result: ProjectSearchResult) => void>();
  render(<SearchHarness onOpen={onOpen} />);
  fireEvent.click(screen.getByRole('button', { name: 'Projekt durchsuchen' }));
  const field = screen.getByRole('searchbox', {
    name: 'Nachrichten, Entscheidungen, Canvas und Plan',
  });
  return { onOpen, field };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ProjectSearch (spec 56)', () => {
  it('opens from its button with the field focused and the button marked as expanded', () => {
    const { field } = openSearch();

    expect(field).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Projekt durchsuchen' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('search', { name: 'Projekt durchsuchen' })).toBeInTheDocument();
  });

  it('searches on Enter only, and shows each result with its kind, title and snippet', async () => {
    const fetcher = stubSearch(() => json({ results: RESULTS }));
    const { field, onOpen } = openSearch();

    fireEvent.change(field, { target: { value: 'hosting' } });
    expect(fetcher).not.toHaveBeenCalled();
    fireEvent.submit(field);

    expect(await screen.findByText('2 Ergebnisse')).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      '/api/projects/project-1/search?q=hosting',
      expect.anything(),
    );
    expect(screen.getByText('Entscheidung')).toBeInTheDocument();
    expect(screen.getByText('Our own server or managed hosting')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /AI gateway/ }));
    expect(onOpen).toHaveBeenCalledWith(RESULTS[1]);
  });

  it('keeps the search button disabled below two characters', () => {
    const { field } = openSearch();

    fireEvent.change(field, { target: { value: 'a' } });

    expect(screen.getByRole('button', { name: 'Suchen' })).toBeDisabled();
  });

  it('says when nothing was found, with the query', async () => {
    stubSearch(() => json({ results: [] }));
    const { field } = openSearch();

    fireEvent.change(field, { target: { value: 'kubernetes' } });
    fireEvent.submit(field);

    expect(await screen.findByText('Nichts gefunden für „kubernetes“.')).toBeInTheDocument();
  });

  it('says when the search failed', async () => {
    stubSearch(() => json({ error: { code: 'server_error', message: 'x' } }, 500));
    const { field } = openSearch();

    fireEvent.change(field, { target: { value: 'hosting' } });
    fireEvent.submit(field);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Die Suche konnte nicht geladen werden.',
    );
  });

  it('closes with Escape and with its close button, giving the focus back', async () => {
    const { field } = openSearch();

    fireEvent.keyDown(field, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByRole('search')).not.toBeInTheDocument();
    });
    const button = screen.getByRole('button', { name: 'Projekt durchsuchen' });
    expect(button).toHaveFocus();
    expect(button).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(button);
    fireEvent.click(screen.getByRole('button', { name: 'Suche schließen' }));
    expect(screen.queryByRole('search')).not.toBeInTheDocument();
  });

  it('starts on a phone from a row that looks like the field', () => {
    const onClick = vi.fn();
    render(<ProjectSearchRow onClick={onClick} />);

    fireEvent.click(screen.getByRole('button', { name: 'Projekt durchsuchen' }));

    expect(onClick).toHaveBeenCalledOnce();
  });
});
