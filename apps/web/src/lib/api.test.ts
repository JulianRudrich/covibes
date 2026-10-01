import { describe, expect, it, vi } from 'vitest';

import { api, ApiError } from '@web/lib/api';
import { stubApi } from '@web/test-utils';

describe('api', () => {
  it('returns the JSON answer', async () => {
    stubApi({ 'GET /api/projects': () => ({ body: [{ id: 'p1' }] }) });
    await expect(api('/projects')).resolves.toEqual([{ id: 'p1' }]);
  });

  it('answers "no content" without a body, e.g. after deleting', async () => {
    stubApi({ 'DELETE /api/projects/p1/boards/b1': () => ({ status: 204, body: null }) });
    await expect(
      api<undefined>('/projects/p1/boards/b1', { method: 'DELETE' }),
    ).resolves.toBeUndefined();
  });

  it('sends JSON as JSON and a form as it is', async () => {
    const types: (string | null)[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        types.push(new Headers(init?.headers).get('content-type'));
        return Promise.resolve(new Response(null, { status: 204 }));
      }),
    );
    await api('/projects', { method: 'POST', body: '{}' });
    await api('/projects/p1/files', { method: 'POST', body: new FormData() });
    await api('/projects');
    vi.unstubAllGlobals();

    // The browser sets the type and boundary of a form itself.
    expect(types).toEqual(['application/json', null, null]);
  });

  it('throws the error code of the server', async () => {
    stubApi({
      'POST /api/projects/p1/boards': () => ({
        status: 409,
        body: { error: { code: 'limit_reached', message: 'The limit is reached.' } },
      }),
    });
    await expect(api('/projects/p1/boards', { method: 'POST', body: '{}' })).rejects.toEqual(
      new ApiError(409, 'limit_reached'),
    );
  });
});
