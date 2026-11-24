import { randomUUID } from 'node:crypto';

import type { ProjectSummary } from '@covibes/shared';
import { describe, expect, it, vi } from 'vitest';

import { cleanStoredFile, fileCleanupTask } from '@server/tasks/file-cleanup';
import { APP_URL, createTestServer } from '@server/testing';

const test = createTestServer();

describe('durable file cleanup', () => {
  it('retains failures, schedules a fresh retry, and handles duplicate deliveries', async () => {
    const key = randomUUID();
    await test.files.put(key, Buffer.from('Keep until cleanup succeeds'));
    await test.db.admin.insertInto('file_cleanup').values({ storage_key: key }).execute();
    const failing = {
      ...test.files,
      delete: vi.fn().mockRejectedValue(new Error('Storage unavailable')),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const task = fileCleanupTask(test.db.admin, failing);
      await task({ key }, {} as never);
      expect(failing.delete).toHaveBeenCalledOnce();
      const pending = await test.db.admin
        .selectFrom('file_cleanup')
        .selectAll()
        .where('storage_key', '=', key)
        .executeTakeFirstOrThrow();
      expect(pending.attempts).toBe(1);
      expect(pending.last_error_at).toBeInstanceOf(Date);
      expect(
        (
          await test.db.adminPool.query(
            'select run_at>now() as deferred from graphile_worker.jobs where key=$1',
            [`file_cleanup:${key}`],
          )
        ).rows,
      ).toEqual([{ deferred: true }]);
      expect(await test.files.get(key)).toBeDefined();
      expect(await cleanStoredFile(test.db.admin, test.files, key)).toBe('deleted');
      expect(await cleanStoredFile(test.db.admin, test.files, key)).toBe('nothing');
      expect(await test.files.get(key)).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('does not delete a key that is still referenced by surviving metadata', async () => {
    const cookie = await test.signIn();
    const created = await test.app.request('/api/projects', {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Retained file' }),
    });
    const { id } = (await created.json()) as ProjectSummary;
    const form = new FormData();
    form.set('file', new File(['Still in use'], 'notes.txt'));
    expect(
      (
        await test.app.request(`/api/projects/${id}/files`, {
          method: 'POST',
          headers: { cookie, origin: APP_URL },
          body: form,
        })
      ).status,
    ).toBe(201);
    const stored = await test.db.admin
      .selectFrom('files')
      .select('storage_key')
      .where('project_id', '=', id)
      .executeTakeFirstOrThrow();
    await test.db.admin
      .insertInto('file_cleanup')
      .values({ storage_key: stored.storage_key })
      .execute();
    expect(await cleanStoredFile(test.db.admin, test.files, stored.storage_key)).toBe('referenced');
    expect(await test.files.get(stored.storage_key)).toBeDefined();
    await test.db.admin.deleteFrom('files').where('storage_key', '=', stored.storage_key).execute();
    expect(await cleanStoredFile(test.db.admin, test.files, stored.storage_key)).toBe('deleted');
  });
});
