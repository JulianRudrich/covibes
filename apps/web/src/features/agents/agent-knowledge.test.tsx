import type { AgentKnowledgeItem } from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentKnowledge } from '@web/features/agents/agent-knowledge';

const AGENT = '33333333-3333-4333-8333-333333333333';
const BASE = `/api/agents/${AGENT}/knowledge`;

const FILE: AgentKnowledgeItem = {
  id: '44444444-4444-4444-8444-444444444444',
  kind: 'file',
  name: 'satzung.pdf',
  url: null,
  note: '',
  fileKind: 'pdf',
  mediaType: 'application/pdf',
  sizeBytes: 340_000,
};
const LINK: AgentKnowledgeItem = {
  id: '55555555-5555-4555-8555-555555555555',
  kind: 'link',
  name: 'https://example.org/vereinsrecht',
  url: 'https://example.org/vereinsrecht',
  note: 'Vereinsrecht im Überblick',
  fileKind: null,
  mediaType: null,
  sizeBytes: null,
};

type Call = { url: string; method: string; body: unknown };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** A server that keeps the knowledge in memory, or fails a change with `failWith`. */
function stubKnowledge(initial: AgentKnowledgeItem[], failWith?: { code: string; status: number }) {
  let items = [...initial];
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      if (method === 'GET') return Promise.resolve(json(items));
      const body: unknown =
        typeof init?.body === 'string'
          ? JSON.parse(init.body)
          : init?.body instanceof FormData
            ? (init.body.get('file') as File).name
            : undefined;
      calls.push({ url, method, body });
      if (failWith) {
        return Promise.resolve(
          json({ error: { code: failWith.code, message: 'No' } }, failWith.status),
        );
      }
      if (method === 'DELETE') {
        items = items.filter((item) => !url.endsWith(item.id));
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      const added: AgentKnowledgeItem = url.endsWith('/links')
        ? { ...LINK, id: crypto.randomUUID(), ...(body as { url: string; note: string }) }
        : { ...FILE, id: crypto.randomUUID(), name: String(body) };
      items = [...items, added];
      return Promise.resolve(json(added, 201));
    }),
  );
  return calls;
}

function renderKnowledge() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AgentKnowledge agentKey={AGENT} />
    </QueryClientProvider>,
  );
  return screen.getByRole('group', { name: /Wissen/ });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AgentKnowledge', () => {
  it('lists files and links with what they are', async () => {
    stubKnowledge([FILE, LINK]);
    const section = renderKnowledge();

    const list = await within(section).findByRole('list', { name: 'Wissen' });
    const [file, link] = within(list).getAllByRole('listitem');
    expect(section).toHaveTextContent('2 / 10');
    expect(file).toHaveTextContent('satzung.pdf340 kB');
    expect(within(file as HTMLElement).getByRole('link', { name: 'satzung.pdf' })).toHaveAttribute(
      'href',
      `${BASE}/${FILE.id}/content`,
    );
    expect(link).toHaveTextContent('https://example.org/vereinsrechtVereinsrecht im Überblick');
    const anchor = within(link as HTMLElement).getByRole('link');
    expect(anchor).toHaveAttribute('href', 'https://example.org/vereinsrecht');
    expect(anchor).toHaveAttribute('target', '_blank');
    expect(anchor).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('adds a link with its note, also with Enter, and clears the fields', async () => {
    const calls = stubKnowledge([]);
    const section = renderKnowledge();
    const url = within(section).getByLabelText('Adresse des Links');
    const note = within(section).getByLabelText('Notiz zum Link');
    expect(within(section).getByRole('button', { name: 'Link hinzufügen' })).toBeDisabled();

    fireEvent.change(url, { target: { value: ' https://example.org/a ' } });
    fireEvent.change(note, { target: { value: ' Wofür ' } });
    fireEvent.click(within(section).getByRole('button', { name: 'Link hinzufügen' }));

    expect(
      await within(section).findByRole('link', { name: 'https://example.org/a' }),
    ).toBeVisible();
    expect(calls).toEqual([
      {
        url: `${BASE}/links`,
        method: 'POST',
        body: { url: 'https://example.org/a', note: 'Wofür' },
      },
    ]);
    await waitFor(() => {
      expect(url).toHaveValue('');
    });
    expect(note).toHaveValue('');

    // Enter in the fields adds the link; it never submits the form around the section.
    fireEvent.change(url, { target: { value: 'https://example.org/b' } });
    const enter = fireEvent.keyDown(url, { key: 'Enter' });
    expect(enter).toBe(false);
    expect(
      await within(section).findByRole('link', { name: 'https://example.org/b' }),
    ).toBeVisible();
  });

  it('asks for a web address before it asks the server', () => {
    const calls = stubKnowledge([]);
    const section = renderKnowledge();

    fireEvent.change(within(section).getByLabelText('Adresse des Links'), {
      target: { value: 'example.org' },
    });
    fireEvent.click(within(section).getByRole('button', { name: 'Link hinzufügen' }));

    expect(within(section).getByRole('alert')).toHaveTextContent(
      'Bitte eine Web-Adresse, die mit http:// oder https:// beginnt.',
    );
    expect(calls).toEqual([]);
  });

  it('uploads the chosen files one after the other', async () => {
    const calls = stubKnowledge([]);
    const section = renderKnowledge();

    fireEvent.change(within(section).getByLabelText('Datei für das Wissen auswählen'), {
      target: { files: [new File(['a'], 'eins.md'), new File(['b'], 'zwei.md')] },
    });

    expect(await within(section).findByRole('link', { name: 'zwei.md' })).toBeVisible();
    expect(calls).toEqual([
      { url: `${BASE}/files`, method: 'POST', body: 'eins.md' },
      { url: `${BASE}/files`, method: 'POST', body: 'zwei.md' },
    ]);
  });

  it('says why a file was not taken', async () => {
    const calls = stubKnowledge([], { code: 'unsupported_file', status: 415 });
    const section = renderKnowledge();
    const picker = within(section).getByLabelText('Datei für das Wissen auswählen');

    fireEvent.change(picker, { target: { files: [new File(['MZ'], 'setup.exe')] } });
    expect(await within(section).findByRole('alert')).toHaveTextContent('Diese Datei geht nicht');

    // A file beyond the limit is not even sent.
    const large = new File(['x'], 'gross.pdf');
    Object.defineProperty(large, 'size', { value: 10 * 1024 * 1024 + 1 });
    fireEvent.change(picker, { target: { files: [large] } });
    await waitFor(() => {
      expect(within(section).getByRole('alert')).toHaveTextContent('Die Datei ist zu groß');
    });
    expect(calls).toHaveLength(1);
  });

  it('removes an entry', async () => {
    const calls = stubKnowledge([FILE, LINK]);
    const section = renderKnowledge();

    fireEvent.click(await within(section).findByRole('button', { name: 'satzung.pdf entfernen' }));

    await waitFor(() => {
      expect(within(section).queryByRole('link', { name: 'satzung.pdf' })).not.toBeInTheDocument();
    });
    expect(calls).toEqual([{ url: `${BASE}/${FILE.id}`, method: 'DELETE', body: undefined }]);
    expect(section).toHaveTextContent('1 / 10');
  });

  it('offers nothing more to add once it holds ten entries', async () => {
    stubKnowledge(
      Array.from({ length: 10 }, (_, index) => ({
        ...LINK,
        id: `${LINK.id.slice(0, -1)}${String(index)}`,
      })),
    );
    const section = renderKnowledge();

    expect(await within(section).findByText(/Mehr als 10 Einträge gehen nicht/)).toBeVisible();
    expect(
      within(section).queryByRole('button', { name: 'Link hinzufügen' }),
    ).not.toBeInTheDocument();
    expect(
      within(section).queryByRole('button', { name: 'Datei hinzufügen' }),
    ).not.toBeInTheDocument();
    expect(within(section).getAllByRole('listitem')).toHaveLength(10);
  });
});
