import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WorkspaceInvitations } from '@web/features/workspaces/workspace-invitations';
import { createQueryClient } from '@web/lib/query-client';
import { stubApi } from '@web/test-utils';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const token = 'a'.repeat(64);

describe('workspace invitations', () => {
  it('creates an email-bound invitation and displays the link returned by the server', async () => {
    const requests = stubApi({
      [`GET /api/workspaces/${workspaceId}/invitations`]: () => ({ body: [] }),
      [`POST /api/workspaces/${workspaceId}/invitations`]: () => ({
        body: { id: 'invite', token },
      }),
      'GET /api/projects': () => ({ body: [] }),
    });
    render(
      <QueryClientProvider client={createQueryClient()}>
        <WorkspaceInvitations workspaceId={workspaceId} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText('Auf E-Mail-Adresse beschränken (optional)'), {
      target: { value: 'Member@example.com' },
    });
    fireEvent.change(screen.getByLabelText('Eingeladene Rolle'), { target: { value: 'viewer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Einladungslink erstellen' }));
    const link = await screen.findByLabelText('Neuer Einladungslink');
    expect(link).toHaveValue(`${window.location.origin}/workspace-invite/${token}`);
    await waitFor(() => {
      expect(requests).toHaveBeenCalledWith(
        `/api/workspaces/${workspaceId}/invitations`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ email: 'member@example.com', role: 'viewer' }),
        }),
      );
    });
  });
});
