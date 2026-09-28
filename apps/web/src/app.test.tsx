import { createMemoryHistory } from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '@web/app';
import { createAppRouter } from '@web/router';

function renderAt(path: string) {
  const router = createAppRouter(createMemoryHistory({ initialEntries: [path] }));
  render(<App router={router} />);
  return router;
}

describe('App', () => {
  it('redirects the start page to the demo project', async () => {
    const router = renderAt('/');

    expect(await screen.findByRole('button', { name: 'Teilen' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/p/demo');
  });

  it('renders the workspace header and the three panels', async () => {
    renderAt('/p/demo');

    expect(await screen.findByText('covibes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Covibes V1/ })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Phasen' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Chat' })).toBeInTheDocument();
    expect(screen.getByText('Haupt-Canvas')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Überblick' })).toBeInTheDocument();
  });

  it('labels every avatar in the header', async () => {
    renderAt('/p/demo');

    const humans = await screen.findByRole('group', { name: 'Menschen' });
    const agents = screen.getByRole('group', { name: 'Agents' });
    expect(humans).toBeInTheDocument();
    for (const name of ['Du', 'Alex', 'Sam', 'Moderator', 'Backend', 'Kritiker', 'Daten']) {
      expect(screen.getByRole('img', { name })).toBeInTheDocument();
    }
    expect(agents.querySelectorAll('[role="img"]')).toHaveLength(4);
  });
});
