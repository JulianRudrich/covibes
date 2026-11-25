import { workspaceInvitationInputSchema } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { Inset, Notice } from '@web/components/ui/card';
import { FieldError, Input, Label } from '@web/components/ui/input';
import { Select } from '@web/components/ui/select';
import {
  useWorkspaceActions,
  workspaceErrorKey,
  workspaceInvitationsQuery,
} from '@web/features/workspaces/queries';

export function WorkspaceInvitations({ workspaceId }: { workspaceId: string }) {
  const { t, i18n } = useTranslation();
  const invitations = useQuery(workspaceInvitationsQuery(workspaceId));
  const { invite, revoke } = useWorkspaceActions(workspaceId);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'viewer' | 'editor'>('editor');
  const [invalid, setInvalid] = useState(false);
  const [link, setLink] = useState<string>();
  const [copy, setCopy] = useState<'copied' | 'failed'>();
  const linkInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (link) linkInput.current?.focus();
  }, [link]);

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = workspaceInvitationInputSchema.safeParse({
      ...(email.trim() ? { email: email.trim() } : {}),
      role,
    });
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    invite.mutate(parsed.data, {
      onSuccess: (created) => {
        setLink(new URL(`/workspace-invite/${created.token}`, window.location.origin).toString());
        setCopy(undefined);
        setEmail('');
      },
    });
  }

  return (
    <div className="grid gap-4">
      <p className="m-0 text-small text-text-3">{t('workspaces.invitationDescription')}</p>
      <form noValidate onSubmit={submit} className="grid gap-3">
        <Label htmlFor="workspace-invite-email">{t('workspaces.invitationEmail')}</Label>
        <Input
          id="workspace-invite-email"
          type="email"
          value={email}
          autoComplete="email"
          maxLength={254}
          aria-invalid={invalid}
          aria-describedby={
            invalid ? 'workspace-invite-email-error' : 'workspace-invite-email-hint'
          }
          disabled={invite.isPending}
          onChange={(event) => {
            setEmail(event.target.value);
            setInvalid(false);
          }}
        />
        <p id="workspace-invite-email-hint" className="m-0 text-small text-text-3">
          {t('workspaces.invitationEmailHint')}
        </p>
        {invalid ? (
          <FieldError id="workspace-invite-email-error">{t('auth.errors.invalidEmail')}</FieldError>
        ) : null}
        <Label htmlFor="workspace-invite-role">{t('workspaces.invitationRole')}</Label>
        <Select
          id="workspace-invite-role"
          size="field"
          value={role}
          disabled={invite.isPending}
          onChange={(event) => {
            setRole(event.target.value === 'viewer' ? 'viewer' : 'editor');
          }}
        >
          <option value="editor">{t('projects.roles.editor')}</option>
          <option value="viewer">{t('projects.roles.viewer')}</option>
        </Select>
        {invite.isError ? (
          <Notice tone="danger">{t(workspaceErrorKey(invite.error))}</Notice>
        ) : null}
        <div>
          <Button variant="primary" type="submit" disabled={invite.isPending}>
            {t(invite.isPending ? 'common.loading' : 'workspaces.createInvitation')}
          </Button>
        </div>
      </form>
      {link ? (
        <Inset className="grid gap-3 p-4">
          <p role="status" className="m-0 text-small text-text-2">
            {t('workspaces.invitationCreated')}
          </p>
          <Label htmlFor="workspace-invite-link">{t('workspaces.invitationLink')}</Label>
          <Input
            id="workspace-invite-link"
            ref={linkInput}
            value={link}
            readOnly
            onFocus={(event) => {
              event.currentTarget.select();
            }}
          />
          <div>
            <Button
              onClick={() => {
                if (!navigator.clipboard) {
                  setCopy('failed');
                  return;
                }
                void navigator.clipboard.writeText(link).then(
                  () => {
                    setCopy('copied');
                  },
                  () => {
                    setCopy('failed');
                  },
                );
              }}
            >
              {t('workspaces.copyLink')}
            </Button>
          </div>
          {copy ? (
            <p role={copy === 'copied' ? 'status' : 'alert'} className="m-0 text-small text-text-3">
              {t(copy === 'copied' ? 'workspaces.copied' : 'workspaces.copyFailed')}
            </p>
          ) : null}
        </Inset>
      ) : null}
      {invitations.isPending ? (
        <p role="status">{t('common.loading')}</p>
      ) : invitations.isError ? (
        <Notice tone="danger">
          {t('workspaces.loadFailed')}{' '}
          <Button
            onClick={() => {
              void invitations.refetch();
            }}
          >
            {t('workspaces.retry')}
          </Button>
        </Notice>
      ) : invitations.data.length === 0 ? (
        <p className="m-0 text-small text-text-3">{t('workspaces.noInvitations')}</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {invitations.data.map((invitation) => {
            const status = invitation.revokedAt
              ? 'revoked'
              : invitation.acceptedAt
                ? 'accepted'
                : new Date(invitation.expiresAt).getTime() <= Date.now()
                  ? 'expired'
                  : 'active';
            return (
              <li
                key={invitation.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-card bg-bg-subtle p-4"
              >
                <div className="min-w-0 text-small text-text-2">
                  <p className="m-0 break-all font-medium">
                    {invitation.email ?? t('workspaces.anyVerifiedAccount')}
                  </p>
                  <p className="mt-1 mb-0">
                    {t(`projects.roles.${invitation.role}`)} ·{' '}
                    {t(`workspaces.invitationStatus.${status}`)} ·{' '}
                    {t('workspaces.expires', {
                      date: new Date(invitation.expiresAt).toLocaleDateString(i18n.language),
                    })}
                  </p>
                </div>
                {status === 'active' ? (
                  <Button
                    disabled={revoke.isPending}
                    aria-label={t('workspaces.revokeInvitationNamed', {
                      name: invitation.email ?? t('workspaces.anyVerifiedAccount'),
                    })}
                    onClick={() => {
                      revoke.mutate(invitation.id);
                    }}
                  >
                    {t('workspaces.revokeInvitation')}
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {revoke.isError ? <Notice tone="danger">{t(workspaceErrorKey(revoke.error))}</Notice> : null}
    </div>
  );
}
