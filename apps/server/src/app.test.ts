import { describe, expect, it } from 'vitest';

import { createApp } from '@server/app';

describe('GET /health', () => {
  it('reports the server as healthy', async () => {
    const response = await createApp().request('/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});
