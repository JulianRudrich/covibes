import { describe, expect, it } from 'vitest';

import {
  createInvitationInputSchema,
  invitationTokenSchema,
  updateMemberInputSchema,
} from './invitations';

describe('createInvitationInputSchema', () => {
  it('takes a link or a mail, each with the role of an editor or a viewer', () => {
    expect(createInvitationInputSchema.parse({ kind: 'link', role: 'viewer' })).toEqual({
      kind: 'link',
      role: 'viewer',
    });
    // The address is stored trimmed and in lowercase, as the database expects it.
    expect(
      createInvitationInputSchema.parse({
        kind: 'email',
        role: 'editor',
        email: '  Anna.Beispiel@Example.COM ',
      }),
    ).toEqual({ kind: 'email', role: 'editor', email: 'anna.beispiel@example.com' });
  });

  it('refuses owners, missing addresses and other kinds', () => {
    for (const input of [
      { kind: 'link', role: 'owner' },
      { kind: 'link' },
      { kind: 'email', role: 'editor' },
      { kind: 'email', role: 'editor', email: 'keine adresse' },
      { kind: 'email', role: 'editor', email: `${'a'.repeat(250)}@example.com` },
      { kind: 'sms', role: 'editor' },
    ]) {
      expect(createInvitationInputSchema.safeParse(input).success, JSON.stringify(input)).toBe(
        false,
      );
    }
  });
});

describe('invitationTokenSchema', () => {
  it('takes 32 random bytes as base64url and nothing else', () => {
    expect(invitationTokenSchema.safeParse('aB3-_'.repeat(8) + 'abc').success).toBe(true);
    for (const token of ['', 'kurz', 'a'.repeat(42), 'a'.repeat(44), `${'a'.repeat(42)}+`]) {
      expect(invitationTokenSchema.safeParse(token).success, token).toBe(false);
    }
  });
});

describe('updateMemberInputSchema', () => {
  it('changes the role, the Git approval right or both', () => {
    expect(updateMemberInputSchema.parse({ role: 'owner' })).toEqual({ role: 'owner' });
    expect(updateMemberInputSchema.parse({ canApproveGit: true })).toEqual({ canApproveGit: true });
    expect(updateMemberInputSchema.safeParse({}).success).toBe(false);
    expect(updateMemberInputSchema.safeParse({ role: 'admin' }).success).toBe(false);
  });
});
