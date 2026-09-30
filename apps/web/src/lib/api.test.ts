import { describe, expect, it } from 'vitest';

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
