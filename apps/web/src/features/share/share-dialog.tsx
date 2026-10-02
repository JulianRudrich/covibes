import {
  INVITATION_DAYS,
  INVITATION_ROLES,
  PROJECT_ROLES,
  type Invitation,
  type InvitationRole,
  type ProjectDetails,
  type ProjectMember,
  type ProjectRole,
} from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, Link2, Mail, X } from 'lucide-react';
import { useId, useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Avatar } from '@web/components/ui/avatar';
import { Button } from '@web/components/ui/button';
import { DialogClose, DialogContent } from '@web/components/ui/dialog';
import { IconButton } from '@web/components/ui/icon-button';
import { FieldError, Input } from '@web/components/ui/input';
import {
  invitationsQuery,
  useInvitationMutations,
  useMemberMutations,
} from '@web/features/share/queries';
import { ApiError } from '@web/lib/api';
import { cn } from '@web/lib/cn';
import { initialsOf } from '@web/lib/format';

const emailSchema = z.email();

const SELECT =
  'h-7 rounded-md border border-border-strong bg-bg-panel px-2 text-small text-text transition-colors focus-visible:border-ink focus-visible:outline-none disabled:opacity-50';

const SECTION_TITLE = 'm-0 text-small font-medium text-text-2';

type Problem =
  'invalidEmail' | 'alreadyMember' | 'tooManyMails' | 'tooManyInvitations' | 'lastOwner' | 'failed';

function problemOf(error: unknown): Problem {
  if (!(error instanceof ApiError)) return 'failed';
  if (error.code === 'already_member') return 'alreadyMember';
  if (error.code === 'too_many_requests') return 'tooManyMails';
  if (error.code === 'limit_reached') return 'tooManyInvitations';
  if (error.code === 'last_owner') return 'lastOwner';
  return 'failed';
}

type ShareDialogProps = {
  project: Pick<ProjectDetails, 'id' | 'name' | 'role' | 'members'>;
  userId: string;
  /** Whether the server can send mail; without it there are only links. */
  emailInvites: boolean;
  /** Whether the development mailbox exists, to open it after an invitation by mail. */
  devMailbox: boolean;
  /** Called after the user left the project. */
  onLeft: () => void;
};

/**
 * The share dialog (spec 21a, derived look): owners invite by mail or by link, see the open
 * invitations and manage the members; everyone else sees who is in the project. Everyone can
 * leave. The content of a dialog; the caller opens and closes it.
 */
export function ShareDialog({
  project,
  userId,
  emailInvites,
  devMailbox,
  onLeft,
}: ShareDialogProps) {
  const { t } = useTranslation();
  const isOwner = project.role === 'owner';
  const members = useMemberMutations(project.id);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const owners = project.members.filter((member) => member.role === 'owner').length;
  // The last owner stays: someone has to manage the project.
  const lastOwner = isOwner && owners === 1;

  async function leave() {
    setProblem(null);
    try {
      await members.leave.mutateAsync(userId);
      onLeft();
    } catch (error) {
      setProblem(problemOf(error));
      setConfirmingLeave(false);
    }
  }

  return (
    <DialogContent
      title={t('share.title', { project: project.name })}
      description={t(isOwner ? 'share.hintOwner' : 'share.hintMember')}
      className="w-[min(520px,calc(100vw-32px))]"
    >
      <div className="flex max-h-[min(68vh,620px)] flex-col gap-5 overflow-y-auto pr-1">
        {isOwner ? (
          <Invite projectId={project.id} emailInvites={emailInvites} devMailbox={devMailbox} />
        ) : null}

        <section aria-label={t('share.members.title')} className="flex flex-col gap-1.5">
          <h3 className={SECTION_TITLE}>
            {t('share.members.count', { count: project.members.length })}
          </h3>
          <ul className="m-0 flex list-none flex-col p-0">
            {project.members.map((member) => (
              <MemberRow
                key={member.userId}
                member={member}
                isSelf={member.userId === userId}
                canManage={isOwner}
                // The last owner keeps the role.
                roleLocked={member.role === 'owner' && owners === 1}
                busy={members.update.isPending || members.remove.isPending}
                onRole={(role) => {
                  setProblem(null);
                  members.update.mutate(
                    { userId: member.userId, input: { role } },
                    {
                      onError: (error) => {
                        setProblem(problemOf(error));
                      },
                    },
                  );
                }}
                onApproveGit={(canApproveGit) => {
                  setProblem(null);
                  members.update.mutate(
                    { userId: member.userId, input: { canApproveGit } },
                    {
                      onError: (error) => {
                        setProblem(problemOf(error));
                      },
                    },
                  );
                }}
                onRemove={() => {
                  setProblem(null);
                  members.remove.mutate(member.userId, {
                    onError: (error) => {
                      setProblem(problemOf(error));
                    },
                  });
                }}
              />
            ))}
          </ul>
        </section>
      </div>

      {problem ? <FieldError className="mt-3">{t(`share.problems.${problem}`)}</FieldError> : null}

      <div className="mt-4 flex items-center gap-2">
        {confirmingLeave ? (
          <>
            <Button
              variant="danger"
              disabled={members.leave.isPending}
              onClick={() => {
                void leave();
              }}
            >
              {t('share.leave.confirm')}
            </Button>
            <span className="min-w-0 text-small leading-snug text-text-3">
              {t('share.leave.hint')}
            </span>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              className="text-danger"
              disabled={lastOwner}
              aria-describedby={lastOwner ? 'share-last-owner' : undefined}
              onClick={() => {
                setConfirmingLeave(true);
              }}
            >
              {t('share.leave.action')}
            </Button>
            {lastOwner ? (
              <span id="share-last-owner" className="min-w-0 text-small leading-snug text-text-3">
                {t('share.leave.lastOwner')}
              </span>
            ) : null}
          </>
        )}
        <div className="ml-auto flex shrink-0 gap-2">
          <DialogClose asChild>
            <Button variant="primary">{t('common.close')}</Button>
          </DialogClose>
        </div>
      </div>
    </DialogContent>
  );
}

/** Inviting by mail or by link, and the invitations that are still open. */
function Invite({
  projectId,
  emailInvites,
  devMailbox,
}: {
  projectId: string;
  emailInvites: boolean;
  devMailbox: boolean;
}) {
  const { t, i18n } = useTranslation();
  const ids = useId();
  const invitations = useQuery(invitationsQuery(projectId)).data ?? [];
  const { create, resend, revoke } = useInvitationMutations(projectId);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitationRole>('editor');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  /** The link that was just made; it is shown this once. */
  const [link, setLink] = useState<{ url: string; role: InvitationRole } | null>(null);
  const [copied, setCopied] = useState(false);
  const busy = create.isPending;

  function reset() {
    setProblem(null);
    setSentTo(null);
  }

  async function inviteByMail(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    reset();
    const address = email.trim();
    if (!emailSchema.safeParse(address).success) {
      setProblem('invalidEmail');
      return;
    }
    try {
      await create.mutateAsync({ kind: 'email', role, email: address });
      setSentTo(address);
      setEmail('');
    } catch (error) {
      setProblem(problemOf(error));
    }
  }

  async function createLink() {
    reset();
    setCopied(false);
    try {
      const created = await create.mutateAsync({ kind: 'link', role });
      if (created.url) setLink({ url: created.url, role });
    } catch (error) {
      setProblem(problemOf(error));
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
    } catch {
      // No clipboard (e.g. no permission): the field is selected, so it can be copied by hand.
      setCopied(false);
    }
  }

  const date = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }).format(
      new Date(iso),
    );

  return (
    <>
      <section aria-label={t('share.invite.title')} className="flex flex-col gap-2">
        <h3 className={SECTION_TITLE}>{t('share.invite.title')}</h3>
        <form
          noValidate
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            void inviteByMail(event);
          }}
        >
          {emailInvites ? (
            <Input
              id={`${ids}-email`}
              type="email"
              autoComplete="off"
              value={email}
              placeholder={t('auth.emailPlaceholder')}
              aria-label={t('share.invite.email')}
              aria-invalid={problem === 'invalidEmail'}
              className="h-[30px] min-w-[180px] flex-1"
              onChange={(event) => {
                setEmail(event.target.value);
                if (problem === 'invalidEmail') setProblem(null);
              }}
            />
          ) : null}
          <select
            value={role}
            aria-label={t('share.invite.role')}
            className={cn(SELECT, 'h-[30px]')}
            onChange={(event) => {
              const next = INVITATION_ROLES.find((option) => option === event.target.value);
              if (next) setRole(next);
            }}
          >
            {INVITATION_ROLES.map((option) => (
              <option key={option} value={option}>
                {t(`share.invite.as.${option}`)}
              </option>
            ))}
          </select>
          {emailInvites ? (
            <Button type="submit" variant="primary" disabled={busy || email.trim() === ''}>
              {t('share.invite.send')}
            </Button>
          ) : null}
          <Button
            disabled={busy}
            onClick={() => {
              void createLink();
            }}
          >
            <Link2 size={14} aria-hidden="true" />
            {t('share.invite.createLink')}
          </Button>
        </form>

        {sentTo ? (
          <p role="status" className="m-0 text-small text-text-3">
            {t('share.invite.sent', { email: sentTo, days: INVITATION_DAYS })}{' '}
            {devMailbox ? (
              // A plain link in a new tab: the dialog stays as it is.
              <a href="/dev/mails" target="_blank" rel="noreferrer" className="text-small">
                {t('auth.openMailbox')}
              </a>
            ) : null}
          </p>
        ) : null}

        {link ? (
          <div className="flex flex-col gap-1.5 rounded-md border border-border-soft bg-bg-muted p-2.5">
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={link.url}
                aria-label={t('share.invite.link')}
                className="h-7 flex-1 font-mono text-meta"
                onFocus={(event) => {
                  event.target.select();
                }}
              />
              <Button
                size="s"
                onClick={() => {
                  void copyLink();
                }}
              >
                {copied ? (
                  <Check size={13} aria-hidden="true" />
                ) : (
                  <Copy size={13} aria-hidden="true" />
                )}
                {t(copied ? 'share.invite.copied' : 'share.invite.copy')}
              </Button>
            </div>
            <p className="m-0 text-small leading-snug text-text-3">
              {t('share.invite.linkHint', {
                role: t(`projects.roles.${link.role}`),
                days: INVITATION_DAYS,
              })}
            </p>
          </div>
        ) : null}

        {problem ? <FieldError>{t(`share.problems.${problem}`)}</FieldError> : null}
      </section>

      {invitations.length > 0 ? (
        <section aria-label={t('share.open.title')} className="flex flex-col gap-1.5">
          <h3 className={SECTION_TITLE}>{t('share.open.title')}</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {invitations.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                until={date(invitation.expiresAt)}
                busy={resend.isPending || revoke.isPending}
                onResend={() => {
                  reset();
                  resend.mutate(invitation.id, {
                    onSuccess: () => {
                      setSentTo(invitation.email);
                    },
                    onError: (error) => {
                      setProblem(problemOf(error));
                    },
                  });
                }}
                onRevoke={() => {
                  reset();
                  revoke.mutate(invitation.id, {
                    onError: (error) => {
                      setProblem(problemOf(error));
                    },
                  });
                }}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function InvitationRow({
  invitation,
  until,
  busy,
  onResend,
  onRevoke,
}: {
  invitation: Invitation;
  until: string;
  busy: boolean;
  onResend: () => void;
  onRevoke: () => void;
}) {
  const { t } = useTranslation();
  const Icon = invitation.kind === 'email' ? Mail : Link2;
  const name = invitation.email ?? t('share.open.link');
  return (
    <li className="flex min-h-[34px] min-w-0 items-center gap-2 rounded-md border border-border-soft bg-bg-muted py-1 pr-1.5 pl-2 text-small text-text-body">
      <Icon size={15} className="shrink-0 text-text-3" aria-hidden="true" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{name}</span>
        <span className="truncate text-meta text-text-3">
          {t('share.open.meta', { role: t(`projects.roles.${invitation.role}`), date: until })}
          {invitation.kind === 'link' && invitation.uses > 0
            ? ` · ${t('share.open.uses', { count: invitation.uses })}`
            : ''}
        </span>
      </span>
      {invitation.kind === 'email' ? (
        <Button
          size="s"
          variant="ghost"
          disabled={busy}
          aria-label={t('share.open.resendTo', { name })}
          onClick={onResend}
        >
          {t('share.open.resend')}
        </Button>
      ) : null}
      <Button
        size="s"
        variant="ghost"
        disabled={busy}
        aria-label={t('share.open.revokeFor', { name })}
        onClick={onRevoke}
      >
        {t('share.open.revoke')}
      </Button>
    </li>
  );
}

function MemberRow({
  member,
  isSelf,
  canManage,
  roleLocked,
  busy,
  onRole,
  onApproveGit,
  onRemove,
}: {
  member: ProjectMember;
  isSelf: boolean;
  /** Owners change roles, grant the Git approval right and remove members. */
  canManage: boolean;
  roleLocked: boolean;
  busy: boolean;
  onRole: (role: ProjectRole) => void;
  onApproveGit: (canApproveGit: boolean) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const name = isSelf ? `${member.name} (${t('common.you')})` : member.name;

  return (
    <li className="flex min-h-[44px] min-w-0 items-center gap-2.5 border-b border-border-soft py-1.5 last:border-b-0">
      <Avatar kind="human" size={28} label={member.name} initials={initialsOf(member.name)} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui font-medium text-text">{name}</span>
        {member.role === 'editor' && canManage ? (
          <span className="flex items-center gap-1.5 text-meta text-text-3">
            <input
              id={`${id}-git`}
              type="checkbox"
              checked={member.canApproveGit}
              disabled={busy}
              className="size-3 accent-ink enabled:cursor-pointer"
              onChange={(event) => {
                onApproveGit(event.target.checked);
              }}
            />
            <label htmlFor={`${id}-git`} className="cursor-pointer">
              {t('share.members.approvesGit')}
            </label>
          </span>
        ) : member.role === 'editor' && member.canApproveGit ? (
          <span className="text-meta text-text-3">{t('share.members.approvesGit')}</span>
        ) : null}
      </span>

      {confirming ? (
        <>
          <Button
            size="s"
            variant="danger"
            disabled={busy}
            onClick={() => {
              setConfirming(false);
              onRemove();
            }}
          >
            {t('share.members.removeConfirm')}
          </Button>
          <Button
            size="s"
            onClick={() => {
              setConfirming(false);
            }}
          >
            {t('common.cancel')}
          </Button>
        </>
      ) : (
        <>
          {canManage ? (
            <select
              value={member.role}
              disabled={busy || roleLocked}
              aria-label={t('share.members.roleOf', { name: member.name })}
              title={roleLocked ? t('share.members.lastOwner') : undefined}
              className={SELECT}
              onChange={(event) => {
                const next = PROJECT_ROLES.find((option) => option === event.target.value);
                if (next && next !== member.role) onRole(next);
              }}
            >
              {/* The most powerful role first. */}
              {PROJECT_ROLES.toReversed().map((option) => (
                <option key={option} value={option}>
                  {t(`projects.roles.${option}`)}
                </option>
              ))}
            </select>
          ) : (
            <span className="shrink-0 text-small text-text-3">
              {t(`projects.roles.${member.role}`)}
            </span>
          )}
          {canManage && !isSelf ? (
            <IconButton
              aria-label={t('share.members.remove', { name: member.name })}
              title={t('share.members.remove', { name: member.name })}
              disabled={busy}
              onClick={() => {
                setConfirming(true);
              }}
            >
              <X size={14} strokeWidth={2.2} aria-hidden="true" />
            </IconButton>
          ) : canManage ? (
            // Keeps the role selects in one column.
            <span aria-hidden="true" className="size-7 shrink-0" />
          ) : null}
        </>
      )}
    </li>
  );
}
