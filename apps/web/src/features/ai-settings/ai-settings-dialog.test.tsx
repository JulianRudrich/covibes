import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AiSettingsDialog } from './ai-settings-dialog';

const own = { id: 'own', name: 'Mein Team', kind: 'team', role: 'owner' };
const other = { id: 'other', name: 'Fremdes Team', kind: 'team', role: 'editor' };

afterEach(() => vi.unstubAllGlobals());

describe('AI workspace settings', () => {
  it('limits workspace choices to owners and saves and removes a key', async () => {
    let configured = false;
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url === '/api/workspaces') return Promise.resolve(Response.json([own, other]));
      if (url === '/api/workspaces/own/ai/anthropic') {
        configured = init?.method === 'PUT';
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (url === '/api/workspaces/own/ai')
        return Promise.resolve(
          Response.json({
            configured: configured ? ['anthropic'] : [],
            canStoreKeys: true,
            month: '2026-11',
            spending: { workspaceUsd: 2, instanceUsd: 1 },
          }),
        );
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AiSettingsDialog />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'KI-Einstellungen' }));
    const dialog = await screen.findByRole('dialog', { name: 'KI-Einstellungen' });
    const select = await within(dialog).findByRole('combobox', { name: 'Arbeitsbereich' });
    expect(within(select).getAllByRole('option')).toHaveLength(1);
    expect(within(select).getByRole('option', { name: 'Mein Team' })).toBeInTheDocument();
    const input = await within(dialog).findByLabelText('Anthropic');
    fireEvent.change(input, { target: { value: 'test-secret' } });
    const save = within(dialog).getAllByRole('button', { name: 'Schlüssel speichern' })[0];
    if (!save) throw new Error('Save button missing');
    fireEvent.click(save);
    await waitFor(() =>
      expect(within(dialog).getByText('Schlüssel hinterlegt')).toBeInTheDocument(),
    );
    expect(input).toHaveValue('');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/own/ai/anthropic',
      expect.objectContaining({ method: 'PUT', body: JSON.stringify({ key: 'test-secret' }) }),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Schlüssel entfernen' }));
    await waitFor(() =>
      expect(within(dialog).queryByText('Schlüssel hinterlegt')).not.toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/workspaces/own/ai/anthropic',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
