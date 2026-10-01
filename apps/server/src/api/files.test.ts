import { randomUUID } from 'node:crypto';

import type { ApiErrorBody, ChatMessage, MessageAttachment, ProjectSummary } from '@covibes/shared';
import { describe, expect, it, vi } from 'vitest';

import { pdf, PNG } from '@server/test-files';
import { APP_URL, createTestServer } from '@server/testing';

// Uploads and attachments (spec 20a).
const test = createTestServer();

function request(path: string, cookie: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set('cookie', cookie);
  headers.set('origin', APP_URL);
  if (typeof init.body === 'string') headers.set('content-type', 'application/json');
  return test.app.request(path, { ...init, headers });
}

async function errorOf(response: Response) {
  return ((await response.json()) as ApiErrorBody).error.code;
}

async function createProject(cookie: string) {
  const created = await request('/api/projects', cookie, {
    method: 'POST',
    body: JSON.stringify({ name: 'Dateien' }),
  });
  return ((await created.json()) as ProjectSummary).id;
}

async function addMember(projectId: string, cookie: string, role: 'editor' | 'viewer') {
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, session.user.id, role],
  );
}

/** Uploads like the browser does: one file in a form. */
function upload(projectId: string, cookie: string, name: string, content: Uint8Array | string) {
  const form = new FormData();
  form.set('file', new File([content], name));
  return request(`/api/projects/${projectId}/files`, cookie, { method: 'POST', body: form });
}

async function uploaded(
  projectId: string,
  cookie: string,
  name: string,
  content: Uint8Array | string,
) {
  const response = await upload(projectId, cookie, name, content);
  expect(response.status).toBe(201);
  return (await response.json()) as MessageAttachment;
}

const download = (projectId: string, cookie: string, fileId: string) =>
  request(`/api/projects/${projectId}/files/${fileId}`, cookie);

const send = (projectId: string, cookie: string, body: Record<string, unknown>) =>
  request(`/api/projects/${projectId}/messages`, cookie, {
    method: 'POST',
    body: JSON.stringify({ id: randomUUID(), content: 'Schaut mal', ...body }),
  });

describe('uploads', () => {
  it('take images, PDFs and text files and say what they are', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);

    expect(await uploaded(projectId, owner, 'skizze.png', PNG)).toEqual({
      id: expect.any(String) as unknown,
      name: 'skizze.png',
      kind: 'image',
      mediaType: 'image/png',
      sizeBytes: PNG.byteLength,
    });
    expect(await uploaded(projectId, owner, 'plan.pdf', pdf(['Seite eins']))).toMatchObject({
      kind: 'pdf',
      mediaType: 'application/pdf',
    });
    // The server goes by the content: an image stays an image whatever it is called.
    expect(await uploaded(projectId, owner, 'C:\\tmp\\..\\bild.txt', PNG)).toMatchObject({
      name: 'bild.txt',
      kind: 'image',
    });
    expect(await uploaded(projectId, owner, 'Notizen.md', '# Ideen\nÄpfel')).toMatchObject({
      name: 'Notizen.md',
      kind: 'text',
      mediaType: 'text/markdown',
      sizeBytes: 14,
    });
  });

  it('refuse other kinds, empty and oversized files', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    const stored = test.files.keys().length;

    const program = await upload(projectId, owner, 'setup.exe', new Uint8Array([0x4d, 0x5a, 0]));
    expect(program.status).toBe(415);
    expect(await errorOf(program)).toBe('unsupported_file');
    expect((await upload(projectId, owner, 'bild.png', 'kein Bild')).status).toBe(415);
    expect((await upload(projectId, owner, 'logo.svg', '<svg/>')).status).toBe(415);
    expect((await upload(projectId, owner, 'leer.txt', '')).status).toBe(400);

    // An image may have 5 MB, any file 10 MB; beyond that the body is not even read to the end.
    const largeImage = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
    const image = await upload(projectId, owner, 'gross.png', largeImage);
    expect(image.status).toBe(413);
    expect(await errorOf(image)).toBe('too_large');
    const largeText = 'a'.repeat(10 * 1024 * 1024 + 70 * 1024);
    expect((await upload(projectId, owner, 'gross.txt', largeText)).status).toBe(413);

    const noFile = await request(`/api/projects/${projectId}/files`, owner, {
      method: 'POST',
      body: new FormData(),
    });
    expect(noFile.status).toBe(400);
    // Nothing of all this was stored.
    expect(test.files.keys()).toHaveLength(stored);
  });

  it('are for owners and editors; members open them, nobody else', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const viewer = await test.signIn();
    const stranger = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    await addMember(projectId, viewer, 'viewer');

    const file = await uploaded(projectId, editor, 'Notizen.md', '# Ideen');
    expect((await upload(projectId, viewer, 'a.md', 'x')).status).toBe(403);
    expect((await upload(projectId, stranger, 'a.md', 'x')).status).toBe(404);
    expect((await upload(projectId, '', 'a.md', 'x')).status).toBe(401);

    for (const member of [owner, editor, viewer]) {
      expect((await download(projectId, member, file.id)).status).toBe(200);
    }
    expect((await download(projectId, stranger, file.id)).status).toBe(404);
    expect((await download(projectId, owner, randomUUID())).status).toBe(404);
    // Not through another project either.
    const other = await createProject(owner);
    expect((await download(other, owner, file.id)).status).toBe(404);
  });

  it('are served so that the browser runs nothing', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    const page = await uploaded(
      projectId,
      owner,
      'Übersicht (1).html',
      '<script>alert(1)</script>',
    );
    const image = await uploaded(projectId, owner, 'skizze.png', PNG);

    const html = await download(projectId, owner, page.id);
    expect(html.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(html.headers.get('content-disposition')).toBe(
      "attachment; filename*=UTF-8''%C3%9Cbersicht%20%281%29.html",
    );
    expect(html.headers.get('x-content-type-options')).toBe('nosniff');
    expect(html.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(await html.text()).toBe('<script>alert(1)</script>');

    const png = await download(projectId, owner, image.id);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect(png.headers.get('content-disposition')).toBe("inline; filename*=UTF-8''skizze.png");
    expect(Buffer.from(await png.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it('can be taken back before the message is sent, by the uploader', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    const file = await uploaded(projectId, editor, 'Notizen.md', '# Ideen');
    const stored = test.files.keys().length;
    const remove = (cookie: string) =>
      request(`/api/projects/${projectId}/files/${file.id}`, cookie, { method: 'DELETE' });

    expect((await remove(owner)).status).toBe(404);
    expect((await remove(editor)).status).toBe(204);
    expect(test.files.keys()).toHaveLength(stored - 1);
    expect((await download(projectId, editor, file.id)).status).toBe(404);
    expect((await remove(editor)).status).toBe(404);
  });

  it('make room for uploads that were never sent', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    const stale = await uploaded(projectId, owner, 'alt.md', 'alt');
    await test.db.admin
      .updateTable('files')
      .set({ created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) })
      .where('id', '=', stale.id)
      .execute();

    const fresh = await uploaded(projectId, owner, 'neu.md', 'neu');

    expect((await download(projectId, owner, stale.id)).status).toBe(404);
    expect((await download(projectId, owner, fresh.id)).status).toBe(200);
  });
});

describe('attachments', () => {
  it('go along with the message and reach everyone live', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    const image = await uploaded(projectId, owner, 'skizze.png', PNG);
    const notes = await uploaded(projectId, owner, 'Notizen.md', '# Ideen');
    const publish = vi.spyOn(test.realtime, 'publish');
    const id = randomUUID();

    const sent = await send(projectId, owner, { id, attachments: [image.id, notes.id] });

    expect(sent.status).toBe(201);
    const message = (await sent.json()) as ChatMessage;
    expect(message.attachments).toEqual([image, notes]);
    expect(publish).toHaveBeenCalledWith(projectId, { type: 'message', message });
    publish.mockRestore();

    const listed = (await (
      await request(`/api/projects/${projectId}/messages`, owner)
    ).json()) as ChatMessage[];
    expect(listed.find((entry) => entry.id === id)?.attachments).toEqual([image, notes]);
    // A message without files has no attachments at all.
    const plain = (await (await send(projectId, owner, {})).json()) as ChatMessage;
    expect(plain).not.toHaveProperty('attachments');

    // Sending the same message again (after a lost answer) returns it as it is.
    const again = await send(projectId, owner, { id, attachments: [image.id, notes.id] });
    expect(again.status).toBe(200);
    expect(((await again.json()) as ChatMessage).attachments).toEqual([image, notes]);

    // An attached file stays: it can neither be taken back nor go to a second message.
    const remove = await request(`/api/projects/${projectId}/files/${image.id}`, owner, {
      method: 'DELETE',
    });
    expect(remove.status).toBe(404);
    expect((await send(projectId, owner, { attachments: [image.id] })).status).toBe(400);
  });

  it('are only the sender own uploads in this project, at most five, each once', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    const other = await createProject(owner);
    const foreign = await uploaded(projectId, editor, 'fremd.md', 'x');
    const elsewhere = await uploaded(other, owner, 'woanders.md', 'x');
    const own = await uploaded(projectId, owner, 'eigen.md', 'x');

    expect((await send(projectId, owner, { attachments: [foreign.id] })).status).toBe(400);
    expect((await send(projectId, owner, { attachments: [elsewhere.id] })).status).toBe(400);
    expect((await send(projectId, owner, { attachments: [randomUUID()] })).status).toBe(400);
    expect((await send(projectId, owner, { attachments: [own.id, own.id] })).status).toBe(400);
    const six = Array.from({ length: 6 }, () => randomUUID());
    expect((await send(projectId, owner, { attachments: six })).status).toBe(400);

    // Nothing was sent or attached by the refused attempts.
    const messages = (await (
      await request(`/api/projects/${projectId}/messages`, owner)
    ).json()) as ChatMessage[];
    expect(messages).toEqual([]);
    expect((await send(projectId, owner, { attachments: [own.id] })).status).toBe(201);
  });
});
