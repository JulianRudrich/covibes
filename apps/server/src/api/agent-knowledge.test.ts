import type {
  AgentKnowledgeItem,
  ApiErrorBody,
  CustomAgent,
  ProjectDetails,
  ProjectSummary,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { pdf, PNG } from '@server/test-files';
import { APP_URL, createTestServer } from '@server/testing';

// The knowledge of custom agents and the project's web switch (spec 20b).
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
    body: JSON.stringify({ name: 'Wissen' }),
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

let names = 0;
async function createAgent(cookie: string, projectId: string | null = null) {
  names += 1;
  const response = await request('/api/agents', cookie, {
    method: 'POST',
    body: JSON.stringify({
      name: `Archivar ${String(names)}`,
      role: 'Kennt die Unterlagen',
      color: 3,
      projectId,
    }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as CustomAgent).key;
}

const list = (cookie: string, agent: string) => request(`/api/agents/${agent}/knowledge`, cookie);

async function listOf(cookie: string, agent: string) {
  const response = await list(cookie, agent);
  expect(response.status).toBe(200);
  return (await response.json()) as AgentKnowledgeItem[];
}

function addFile(cookie: string, agent: string, name: string, content: Uint8Array | string) {
  const form = new FormData();
  form.set('file', new File([content], name));
  return request(`/api/agents/${agent}/knowledge/files`, cookie, { method: 'POST', body: form });
}

const addLink = (cookie: string, agent: string, input: Record<string, unknown>) =>
  request(`/api/agents/${agent}/knowledge/links`, cookie, {
    method: 'POST',
    body: JSON.stringify(input),
  });

const remove = (cookie: string, agent: string, item: string) =>
  request(`/api/agents/${agent}/knowledge/${item}`, cookie, { method: 'DELETE' });

const download = (cookie: string, agent: string, item: string) =>
  request(`/api/agents/${agent}/knowledge/${item}/content`, cookie);

describe('the knowledge of a custom agent', () => {
  it('takes files and links, lists them oldest first and removes them', async () => {
    const olga = await test.signIn();
    const agent = await createAgent(olga);
    expect(await listOf(olga, agent)).toEqual([]);

    const file = await addFile(olga, agent, 'satzung.pdf', pdf(['Paragraf 1']));
    expect(file.status).toBe(201);
    const stored = (await file.json()) as AgentKnowledgeItem;
    expect(stored).toMatchObject({
      kind: 'file',
      name: 'satzung.pdf',
      url: null,
      note: '',
      fileKind: 'pdf',
      mediaType: 'application/pdf',
    });
    const link = await addLink(olga, agent, {
      url: ' https://example.org/vereins recht ',
      note: ' Vereinsrecht im Überblick ',
    });
    expect(link.status).toBe(201);
    expect(await link.json()).toMatchObject({
      kind: 'link',
      // Stored as a browser would send it.
      url: 'https://example.org/vereins%20recht',
      name: 'https://example.org/vereins%20recht',
      note: 'Vereinsrecht im Überblick',
      fileKind: null,
      sizeBytes: null,
    });

    const items = await listOf(olga, agent);
    expect(items.map((item) => item.kind)).toEqual(['file', 'link']);

    const content = await download(olga, agent, stored.id);
    expect(content.status).toBe(200);
    expect(content.headers.get('content-type')).toBe('application/pdf');
    expect(content.headers.get('content-disposition')).toContain('attachment');
    expect(content.headers.get('x-content-type-options')).toBe('nosniff');
    // A link has no content to download.
    expect((await download(olga, agent, items[1]?.id ?? '')).status).toBe(404);

    const before = test.files.keys().length;
    expect((await remove(olga, agent, stored.id)).status).toBe(204);
    expect(test.files.keys()).toHaveLength(before - 1);
    expect((await remove(olga, agent, stored.id)).status).toBe(404);
    expect((await download(olga, agent, stored.id)).status).toBe(404);
    expect((await listOf(olga, agent)).map((item) => item.kind)).toEqual(['link']);
  });

  it('decides by the content what a file is and refuses what agents cannot read', async () => {
    const olga = await test.signIn();
    const agent = await createAgent(olga);
    const stored = test.files.keys().length;

    expect(await (await addFile(olga, agent, 'skizze.txt', PNG)).json()).toMatchObject({
      name: 'skizze.txt',
      fileKind: 'image',
      mediaType: 'image/png',
      sizeBytes: PNG.byteLength,
    });
    const program = await addFile(olga, agent, 'setup.exe', new Uint8Array([0x4d, 0x5a, 0]));
    expect(program.status).toBe(415);
    expect(await errorOf(program)).toBe('unsupported_file');
    expect((await addFile(olga, agent, 'leer.txt', '')).status).toBe(400);
    const large = await addFile(olga, agent, 'gross.txt', 'x'.repeat(10 * 1024 * 1024 + 1));
    expect(large.status).toBe(413);
    expect(test.files.keys()).toHaveLength(stored + 1);
  });

  it('only takes web addresses as links', async () => {
    const olga = await test.signIn();
    const agent = await createAgent(olga);

    for (const input of [
      { url: 'ftp://example.org/datei' },
      { url: 'javascript:alert(1)' },
      { url: 'example.org' },
      { url: '' },
      { url: `https://example.org/${'a'.repeat(2000)}` },
      { url: 'https://example.org', note: 'x'.repeat(201) },
      {},
    ]) {
      const response = await addLink(olga, agent, input);
      expect(response.status, JSON.stringify(input).slice(0, 60)).toBe(400);
    }
    expect(await listOf(olga, agent)).toEqual([]);
  });

  it('stops at ten entries', async () => {
    const olga = await test.signIn();
    const agent = await createAgent(olga);
    for (let count = 0; count < 10; count += 1) {
      const added = await addLink(olga, agent, { url: `https://example.org/${String(count)}` });
      expect(added.status).toBe(201);
    }
    const stored = test.files.keys().length;

    const link = await addLink(olga, agent, { url: 'https://example.org/elf' });
    expect(link.status).toBe(409);
    expect(await errorOf(link)).toBe('limit_reached');
    expect((await addFile(olga, agent, 'elf.txt', 'elf')).status).toBe(409);
    // A refused file leaves nothing behind.
    expect(test.files.keys()).toHaveLength(stored);
  });

  it('of a personal agent is its creator’s alone, also in a project that uses the agent', async () => {
    const olga = await test.signIn();
    const other = await test.signIn();
    const projectId = await createProject(other);
    await addMember(projectId, olga, 'editor');
    const agent = await createAgent(olga);
    const team = await request(`/api/projects/${projectId}/agents`, olga, {
      method: 'POST',
      body: JSON.stringify({ agentKey: agent }),
    });
    expect(team.status).toBeLessThan(300);
    const file = (await (
      await addFile(olga, agent, 'notizen.md', '# Privat')
    ).json()) as AgentKnowledgeItem;

    // The owner of the project sees the agent in the team, but not what it knows.
    const details = (await (
      await request(`/api/projects/${projectId}`, other)
    ).json()) as ProjectDetails;
    expect(details.agents.map((entry) => entry.key)).toContain(agent);
    expect((await list(other, agent)).status).toBe(404);
    expect((await download(other, agent, file.id)).status).toBe(404);
    expect((await addLink(other, agent, { url: 'https://example.org' })).status).toBe(404);
    expect((await addFile(other, agent, 'fremd.txt', 'fremd')).status).toBe(404);
    expect((await remove(other, agent, file.id)).status).toBe(404);
    expect(await listOf(olga, agent)).toHaveLength(1);
  });

  it('of a shared agent is seen by the members and maintained by owners and editors', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const viewer = await test.signIn();
    const stranger = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    await addMember(projectId, viewer, 'viewer');
    const agent = await createAgent(owner, projectId);
    const file = (await (
      await addFile(editor, agent, 'leitfaden.md', '# Leitfaden')
    ).json()) as AgentKnowledgeItem;

    expect(await listOf(viewer, agent)).toHaveLength(1);
    expect((await download(viewer, agent, file.id)).status).toBe(200);
    const stored = test.files.keys().length;
    const byViewer = await addLink(viewer, agent, { url: 'https://example.org' });
    expect(byViewer.status).toBe(403);
    expect((await addFile(viewer, agent, 'nein.txt', 'nein')).status).toBe(403);
    expect(test.files.keys()).toHaveLength(stored);
    expect((await remove(viewer, agent, file.id)).status).toBe(403);

    expect((await list(stranger, agent)).status).toBe(404);
    expect((await remove(stranger, agent, file.id)).status).toBe(404);

    expect((await remove(owner, agent, file.id)).status).toBe(204);
    expect(await listOf(editor, agent)).toEqual([]);
  });

  it('needs a session and an agent that exists', async () => {
    const olga = await test.signIn();
    const agent = await createAgent(olga);

    expect((await test.app.request(`/api/agents/${agent}/knowledge`)).status).toBe(401);
    expect((await list(olga, 'moderator')).status).toBe(404);
    expect((await list(olga, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
    expect((await remove(olga, agent, 'kein-eintrag')).status).toBe(404);

    // A deleted agent takes its knowledge with it.
    await addLink(olga, agent, { url: 'https://example.org' });
    expect((await request(`/api/agents/${agent}`, olga, { method: 'DELETE' })).status).toBe(204);
    expect((await list(olga, agent)).status).toBe(404);
  });
});

describe('web access of a project', () => {
  const details = async (cookie: string, projectId: string) =>
    (await (await request(`/api/projects/${projectId}`, cookie)).json()) as ProjectDetails;
  const change = (cookie: string, projectId: string, webAccess: unknown) =>
    request(`/api/projects/${projectId}`, cookie, {
      method: 'PATCH',
      body: JSON.stringify({ webAccess }),
    });

  it('is on until an owner switches it off', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    expect((await details(owner, projectId)).webAccess).toBe(true);

    expect((await change(editor, projectId, false)).status).toBe(403);
    expect((await change(owner, projectId, 'nein')).status).toBe(400);
    expect((await change(owner, projectId, false)).status).toBe(204);
    expect(await details(editor, projectId)).toMatchObject({ webAccess: false, observer: true });

    expect((await change(owner, projectId, true)).status).toBe(204);
    expect((await details(owner, projectId)).webAccess).toBe(true);
  });
});
