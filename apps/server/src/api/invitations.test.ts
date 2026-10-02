import { randomUUID } from 'node:crypto';

import type {
  AcceptInvitationResult,
  ApiErrorBody,
  ChatMessage,
  CreatedInvitation,
  Invitation,
  InvitationPreview,
  ProjectDetails,
  ProjectSummary,
} from '@covibes/shared';
import { describe, expect, it } from 'vitest';

import { APP_URL, createTestServer } from '@server/testing';

// Invitations and members (spec 21a).
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

async function createProject(cookie: string, name = 'Vereins-App') {
  const created = await request('/api/projects', cookie, {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
  return ((await created.json()) as ProjectSummary).id;
}

async function userIdOf(cookie: string) {
  const session = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
  if (!session) throw new Error('No session');
  return session.user.id;
}

async function addMember(projectId: string, cookie: string, role: 'owner' | 'editor' | 'viewer') {
  const userId = await userIdOf(cookie);
  await test.db.adminPool.query(
    'insert into project_members (project_id, user_id, role) values ($1, $2, $3)',
    [projectId, userId, role],
  );
  return userId;
}

const invitationsPath = (projectId: string) => `/api/projects/${projectId}/invitations`;

const invite = (cookie: string, projectId: string, input: Record<string, unknown>) =>
  request(invitationsPath(projectId), cookie, { method: 'POST', body: JSON.stringify(input) });

async function invited(cookie: string, projectId: string, input: Record<string, unknown>) {
  const response = await invite(cookie, projectId, input);
  expect(response.status).toBe(201);
  return (await response.json()) as CreatedInvitation;
}

async function openInvitations(cookie: string, projectId: string) {
  const response = await request(invitationsPath(projectId), cookie);
  expect(response.status).toBe(200);
  return (await response.json()) as Invitation[];
}

const tokenOf = (url: string | null | undefined) => url?.split('/invite/')[1] ?? '';

const preview = (cookie: string, token: string) =>
  request('/api/invitations/preview', cookie, { method: 'POST', body: JSON.stringify({ token }) });

const accept = (cookie: string, token: string) =>
  request('/api/invitations/accept', cookie, { method: 'POST', body: JSON.stringify({ token }) });

async function accepted(cookie: string, token: string) {
  const response = await accept(cookie, token);
  expect(response.status).toBe(200);
  return (await response.json()) as AcceptInvitationResult;
}

async function detailsOf(cookie: string, projectId: string) {
  return (await (await request(`/api/projects/${projectId}`, cookie)).json()) as ProjectDetails;
}

/** The link in the latest mail to an address. */
function mailedLink(email: string) {
  const mail = test.outbox?.list().find((candidate) => candidate.to === email);
  return { mail, token: tokenOf(mail?.text.match(/https?:\/\/\S+\/invite\/\S+/)?.[0]) };
}

const changeMember = (
  cookie: string,
  projectId: string,
  userId: string,
  input: Record<string, unknown>,
) =>
  request(`/api/projects/${projectId}/members/${userId}`, cookie, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });

const removeMember = (cookie: string, projectId: string, userId: string) =>
  request(`/api/projects/${projectId}/members/${userId}`, cookie, { method: 'DELETE' });

describe('invitations by link', () => {
  it('let everyone with the link join with its role', async () => {
    const owner = await test.signIn();
    const guest = await test.signIn();
    const projectId = await createProject(owner);

    const { invitation, url } = await invited(owner, projectId, { kind: 'link', role: 'viewer' });
    expect(url).toMatch(new RegExp(`^${APP_URL}/invite/[A-Za-z0-9_-]{43}$`));
    expect(invitation).toMatchObject({ kind: 'link', role: 'viewer', email: null, uses: 0 });
    const days = (Date.parse(invitation.expiresAt) - Date.parse(invitation.createdAt)) / 86_400_000;
    expect(days).toBeCloseTo(7, 1);
    // The list names the invitation, never its link.
    const listed = await openInvitations(owner, projectId);
    expect(listed).toEqual([invitation]);
    expect(JSON.stringify(listed)).not.toContain(tokenOf(url));

    const token = tokenOf(url);
    const opened = await preview(guest, token);
    expect(opened.status).toBe(200);
    expect((await opened.json()) as InvitationPreview).toEqual({
      status: 'open',
      projectId: null,
      projectName: 'Vereins-App',
      role: 'viewer',
      invitedBy: expect.any(String) as unknown,
    });

    expect(await accepted(guest, token)).toEqual({ status: 'joined', projectId });
    const details = await detailsOf(guest, projectId);
    expect(details.role).toBe('viewer');
    expect(details.members.map((member) => [member.role, member.canApproveGit])).toEqual([
      ['owner', true],
      ['viewer', false],
    ]);
    // Opening the link again leads to the project; nothing changes and no use is counted.
    expect((await (await preview(guest, token)).json()) as InvitationPreview).toMatchObject({
      status: 'member',
      projectId,
    });
    expect(await accepted(guest, token)).toEqual({ status: 'member', projectId });
    expect((await openInvitations(owner, projectId))[0]?.uses).toBe(1);
  });

  it('are made, seen and revoked by owners only', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const viewer = await test.signIn();
    const stranger = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    await addMember(projectId, viewer, 'viewer');
    const { invitation } = await invited(owner, projectId, { kind: 'link', role: 'editor' });
    const revoke = (cookie: string) =>
      request(`${invitationsPath(projectId)}/${invitation.id}`, cookie, { method: 'DELETE' });

    for (const member of [editor, viewer]) {
      expect((await invite(member, projectId, { kind: 'link', role: 'viewer' })).status).toBe(403);
      expect((await request(invitationsPath(projectId), member)).status).toBe(403);
      expect((await revoke(member)).status).toBe(403);
    }
    expect((await invite(stranger, projectId, { kind: 'link', role: 'viewer' })).status).toBe(404);
    expect((await request(invitationsPath(projectId), stranger)).status).toBe(404);
    expect((await revoke(stranger)).status).toBe(404);
    expect((await test.app.request(invitationsPath(projectId))).status).toBe(401);
    expect(await openInvitations(owner, projectId)).toHaveLength(1);
  });

  it('stop working once revoked, and say so', async () => {
    const owner = await test.signIn();
    const guest = await test.signIn();
    const projectId = await createProject(owner);
    const { invitation, url } = await invited(owner, projectId, { kind: 'link', role: 'editor' });
    const path = `${invitationsPath(projectId)}/${invitation.id}`;

    expect((await request(path, owner, { method: 'DELETE' })).status).toBe(204);
    expect((await request(path, owner, { method: 'DELETE' })).status).toBe(404);

    expect(await openInvitations(owner, projectId)).toEqual([]);
    // Nothing about the project is told any more.
    expect((await (await preview(guest, tokenOf(url))).json()) as InvitationPreview).toEqual({
      status: 'revoked',
      projectId: null,
      projectName: null,
      role: null,
      invitedBy: null,
    });
    expect(await accepted(guest, tokenOf(url))).toEqual({ status: 'revoked', projectId: null });
    expect((await request(`/api/projects/${projectId}`, guest)).status).toBe(404);
  });

  it('lead nowhere with a link nobody issued', async () => {
    const guest = await test.signIn();
    const unknown = 'A'.repeat(43);

    for (const token of [unknown, 'kurz', '', `${'a'.repeat(42)}'`]) {
      expect((await preview(guest, token)).status, token).toBe(404);
      expect((await accept(guest, token)).status, token).toBe(404);
    }
    expect(
      (await request('/api/invitations/accept', guest, { method: 'POST', body: '{}' })).status,
    ).toBe(404);
    // Joining needs a session.
    const anonymous = await test.app.request('/api/invitations/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: APP_URL },
      body: JSON.stringify({ token: unknown }),
    });
    expect(anonymous.status).toBe(401);
  });

  it('make editors or viewers, and at most twenty wait at a time', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);

    for (const input of [
      { kind: 'link', role: 'owner' },
      { kind: 'link' },
      { kind: 'sms', role: 'editor' },
      { kind: 'email', role: 'editor' },
      { kind: 'email', role: 'editor', email: 'keine adresse' },
      {},
    ]) {
      expect((await invite(owner, projectId, input)).status, JSON.stringify(input)).toBe(400);
    }

    for (let count = 0; count < 20; count += 1) {
      await invited(owner, projectId, { kind: 'link', role: 'viewer' });
    }
    const next = await invite(owner, projectId, { kind: 'link', role: 'viewer' });
    expect(next.status).toBe(409);
    expect(await errorOf(next)).toBe('limit_reached');
  });
});

describe('invitations by email', () => {
  it('send the link to the address, and it works once', async () => {
    const owner = await test.signIn();
    const guest = await test.signIn();
    const late = await test.signIn();
    const projectId = await createProject(owner, 'Sportverein\nPlanung');
    const email = `${randomUUID()}@Example.com`;

    const { invitation, url } = await invited(owner, projectId, {
      kind: 'email',
      role: 'editor',
      email: `  ${email} `,
    });
    // The link is in the mail only.
    expect(url).toBeNull();
    expect(invitation).toMatchObject({ kind: 'email', role: 'editor', email: email.toLowerCase() });
    const { mail, token } = mailedLink(email.toLowerCase());
    expect(mail?.subject).toBe('Einladung zum Projekt „Sportverein Planung“ in Covibes');
    expect(mail?.text).toContain('lädt dich ein, im Projekt „Sportverein Planung“ in Covibes');
    expect(mail?.text).toContain('als Bearbeiter (mitarbeiten)');
    expect(mail?.text).toContain('Der Link gilt 7 Tage und nur einmal.');
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Whoever has the mail joins, also under another address.
    expect(await accepted(guest, token)).toEqual({ status: 'joined', projectId });
    expect((await detailsOf(guest, projectId)).role).toBe('editor');
    expect(await accepted(late, token)).toEqual({ status: 'used', projectId: null });
    expect((await (await preview(late, token)).json()) as InvitationPreview).toMatchObject({
      status: 'used',
      projectName: null,
    });
    expect(await openInvitations(owner, projectId)).toEqual([]);
  });

  it('are written in the language of the project', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner, 'Club app');
    await test.db.adminPool.query(`update projects set language = 'en' where id = $1`, [projectId]);
    const email = `${randomUUID()}@example.com`;

    await invited(owner, projectId, { kind: 'email', role: 'viewer', email });

    const { mail } = mailedLink(email);
    expect(mail?.subject).toBe('Invitation to the project "Club app" in Covibes');
    expect(mail?.text).toContain('as viewer (read only)');
  });

  it('are not sent to someone who is a member already', async () => {
    const owner = await test.signIn();
    const memberEmail = `${randomUUID()}@example.com`;
    const member = await test.signIn(memberEmail);
    const projectId = await createProject(owner);
    await addMember(projectId, member, 'viewer');
    const mailsBefore = test.outbox?.list().filter((mail) => mail.to === memberEmail).length;

    const response = await invite(owner, projectId, {
      kind: 'email',
      role: 'editor',
      email: memberEmail.toUpperCase(),
    });

    expect(response.status).toBe(409);
    expect(await errorOf(response)).toBe('already_member');
    expect(test.outbox?.list().filter((mail) => mail.to === memberEmail)).toHaveLength(
      mailsBefore ?? 0,
    );
    expect(await openInvitations(owner, projectId)).toEqual([]);
  });

  it('keep one open invitation per address and can be sent again', async () => {
    const owner = await test.signIn();
    const guest = await test.signIn();
    const projectId = await createProject(owner);
    const email = `${randomUUID()}@example.com`;

    await invited(owner, projectId, { kind: 'email', role: 'viewer', email });
    const first = mailedLink(email).token;
    const second = await invited(owner, projectId, { kind: 'email', role: 'editor', email });
    // Inviting the address again replaces the earlier invitation.
    expect(await openInvitations(owner, projectId)).toEqual([second.invitation]);
    expect((await (await preview(guest, first)).json()) as InvitationPreview).toMatchObject({
      status: 'revoked',
    });

    const before = mailedLink(email).token;
    const resent = await request(
      `${invitationsPath(projectId)}/${second.invitation.id}/resend`,
      owner,
      { method: 'POST' },
    );
    expect(resent.status).toBe(200);
    const after = mailedLink(email).token;
    expect(after).not.toBe(before);
    // The link of the mail before is no longer known; the new one works.
    expect((await preview(guest, before)).status).toBe(404);
    expect(await accepted(guest, after)).toEqual({ status: 'joined', projectId });

    // Used invitations and links are not sent again.
    const link = await invited(owner, projectId, { kind: 'link', role: 'viewer' });
    for (const id of [second.invitation.id, link.invitation.id, randomUUID()]) {
      const again = await request(`${invitationsPath(projectId)}/${id}/resend`, owner, {
        method: 'POST',
      });
      expect(again.status).toBe(404);
    }
    const editor = await test.signIn();
    await addMember(projectId, editor, 'editor');
    expect(
      (
        await request(`${invitationsPath(projectId)}/${link.invitation.id}/resend`, editor, {
          method: 'POST',
        })
      ).status,
    ).toBe(403);
  });

  it('stop at twenty mails per person and hour', async () => {
    const owner = await test.signIn();
    const projectId = await createProject(owner);
    const email = `${randomUUID()}@example.com`;

    // The same address again and again: each replaces the one before, so the list stays short.
    for (let count = 0; count < 20; count += 1) {
      await invited(owner, projectId, { kind: 'email', role: 'viewer', email });
    }
    const next = await invite(owner, projectId, { kind: 'email', role: 'viewer', email });
    expect(next.status).toBe(429);
    // Links are no mail and still work.
    expect((await invite(owner, projectId, { kind: 'link', role: 'viewer' })).status).toBe(201);
  });
});

describe('members', () => {
  it('get another role and the right to approve Git actions from an owner', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const projectId = await createProject(owner);
    const editorId = await addMember(projectId, editor, 'editor');
    const memberOf = async (userId: string) =>
      (await detailsOf(owner, projectId)).members.find((member) => member.userId === userId);

    expect((await changeMember(owner, projectId, editorId, { canApproveGit: true })).status).toBe(
      204,
    );
    expect(await memberOf(editorId)).toMatchObject({ role: 'editor', canApproveGit: true });

    // A viewer approves nothing: the right goes with the role.
    expect((await changeMember(owner, projectId, editorId, { role: 'viewer' })).status).toBe(204);
    expect(await memberOf(editorId)).toMatchObject({ role: 'viewer', canApproveGit: false });
    expect((await detailsOf(editor, projectId)).role).toBe('viewer');
    expect((await changeMember(owner, projectId, editorId, { canApproveGit: true })).status).toBe(
      400,
    );

    // Owners approve by their role.
    expect((await changeMember(owner, projectId, editorId, { role: 'owner' })).status).toBe(204);
    expect(await memberOf(editorId)).toMatchObject({ role: 'owner', canApproveGit: true });
    expect((await changeMember(owner, projectId, editorId, { role: 'editor' })).status).toBe(204);
    expect(await memberOf(editorId)).toMatchObject({ role: 'editor', canApproveGit: false });
  });

  it('are changed by owners only', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn();
    const viewer = await test.signIn();
    const stranger = await test.signIn();
    const projectId = await createProject(owner);
    await addMember(projectId, editor, 'editor');
    const viewerId = await addMember(projectId, viewer, 'viewer');

    expect((await changeMember(editor, projectId, viewerId, { role: 'editor' })).status).toBe(403);
    expect((await changeMember(viewer, projectId, viewerId, { role: 'owner' })).status).toBe(403);
    expect((await changeMember(stranger, projectId, viewerId, { role: 'editor' })).status).toBe(
      404,
    );
    expect((await removeMember(editor, projectId, viewerId)).status).toBe(403);
    expect((await removeMember(stranger, projectId, viewerId)).status).toBe(404);

    expect((await changeMember(owner, projectId, viewerId, {})).status).toBe(400);
    expect((await changeMember(owner, projectId, viewerId, { role: 'admin' })).status).toBe(400);
    expect((await changeMember(owner, projectId, randomUUID(), { role: 'editor' })).status).toBe(
      404,
    );
    expect((await changeMember(owner, projectId, 'niemand', { role: 'editor' })).status).toBe(404);
    expect((await detailsOf(owner, projectId)).members.map((member) => member.role)).toEqual([
      'owner',
      'editor',
      'viewer',
    ]);
  });

  it('keep at least one owner', async () => {
    const owner = await test.signIn();
    const second = await test.signIn();
    const projectId = await createProject(owner);
    const ownerId = await userIdOf(owner);
    const secondId = await addMember(projectId, second, 'editor');

    const demoted = await changeMember(owner, projectId, ownerId, { role: 'editor' });
    expect(demoted.status).toBe(409);
    expect(await errorOf(demoted)).toBe('last_owner');
    const left = await removeMember(owner, projectId, ownerId);
    expect(left.status).toBe(409);
    expect(await errorOf(left)).toBe('last_owner');

    // With a second owner the first one can step down and leave.
    expect((await changeMember(owner, projectId, secondId, { role: 'owner' })).status).toBe(204);
    expect((await changeMember(owner, projectId, ownerId, { role: 'viewer' })).status).toBe(204);
    expect((await removeMember(owner, projectId, ownerId)).status).toBe(204);
    expect((await request(`/api/projects/${projectId}`, owner)).status).toBe(404);
    expect((await detailsOf(second, projectId)).members).toHaveLength(1);
  });

  it('are removed by an owner or leave on their own, and their messages keep their name', async () => {
    const owner = await test.signIn();
    const editor = await test.signIn(`frieda-${randomUUID()}@example.com`);
    const viewer = await test.signIn();
    const projectId = await createProject(owner);
    const editorId = await addMember(projectId, editor, 'editor');
    const viewerId = await addMember(projectId, viewer, 'viewer');
    const sent = await request(`/api/projects/${projectId}/messages`, editor, {
      method: 'POST',
      body: JSON.stringify({ id: randomUUID(), content: 'Ich war dabei.' }),
    });
    expect(sent.status).toBe(201);

    expect((await removeMember(owner, projectId, editorId)).status).toBe(204);
    expect((await removeMember(owner, projectId, editorId)).status).toBe(404);
    expect((await removeMember(viewer, projectId, viewerId)).status).toBe(204);

    for (const former of [editor, viewer]) {
      expect((await request(`/api/projects/${projectId}`, former)).status).toBe(404);
      expect((await request(`/api/projects/${projectId}/messages`, former)).status).toBe(404);
    }
    expect((await detailsOf(owner, projectId)).members).toHaveLength(1);
    const messages = (await (
      await request(`/api/projects/${projectId}/messages`, owner)
    ).json()) as ChatMessage[];
    expect(messages).toMatchObject([
      {
        content: 'Ich war dabei.',
        author: {
          kind: 'human',
          userId: editorId,
          name: expect.stringMatching(/^frieda-/) as unknown,
        },
      },
    ]);
  });
});
