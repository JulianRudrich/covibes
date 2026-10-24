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
import { Inset } from '@web/components/ui/card';
import { Checkbox } from '@web/components/ui/checkbox';
import {
  DIALOG_SECTION_TITLE,
  DialogClose,
  DialogContent,
  DialogFooter,
} from '@web/components/ui/dialog';
import { IconButton } from '@web/components/ui/icon-button';
import { FieldError, Input } from '@web/components/ui/input';
import { Select } from '@web/components/ui/select';
import {
  invitationsQuery,
  shareLinkQuery,
  useInvitationMutations,
  useMemberMutations,
  useShareLinkMutations,
} from '@web/features/share/queries';
import { ApiError } from '@web/lib/api';
import { initialsOf } from '@web/lib/format';

const emailSchema = z.email();

const SECTION_TITLE = DIALOG_SECTION_TITLE;

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
 * The share dialog (specs 21a and 21b, derived look): owners invite by mail or by link, see the
 * open invitations and manage the members and the read-only link; everyone else sees who is in the
 * project and whether it has such a link. Everyone can leave. The content of a dialog; the caller opens and closes it.
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
      <div className="-mx-1 flex max-h-[min(68vh,620px)] flex-col gap-6 overflow-y-auto px-1 pb-1">
        {isOwner ? (
          <Invite projectId={project.id} emailInvites={emailInvites} devMailbox={devMailbox} />
        ) : null}

        <section aria-label={t('share.members.title')} className="flex flex-col gap-1">
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

        <ReadOnlyLink projectId={project.id} canManage={isOwner} />
      </div>

      {problem ? <FieldError className="mt-3">{t(`share.problems.${problem}`)}</FieldError> : null}

      <DialogFooter
        start={
          confirmingLeave ? (
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
          )
        }
      >
        <DialogClose asChild>
          <Button variant="primary">{t('common.close')}</Button>
        </DialogClose>
      </DialogFooter>
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
    try {
      const created = await create.mutateAsync({ kind: 'link', role });
      if (created.url) setLink({ url: created.url, role });
    } catch (error) {
      setProblem(problemOf(error));
    }
  }

  const date = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }).format(
      new Date(iso),
    );

  return (
    <>
      <section aria-label={t('share.invite.title')} className="flex flex-col gap-2.5">
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
              className="h-9 min-w-[180px] flex-1 rounded-full px-4"
              onChange={(event) => {
                setEmail(event.target.value);
                if (problem === 'invalidEmail') setProblem(null);
              }}
            />
          ) : null}
          <Select
            value={role}
            aria-label={t('share.invite.role')}
            className="h-9"
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
          </Select>
          {emailInvites ? (
            <Button
              type="submit"
              variant="primary"
              className="h-9 px-4"
              disabled={busy || email.trim() === ''}
            >
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
          <LinkBox
            // A new link starts as "not copied yet".
            key={link.url}
            url={link.url}
            label={t('share.invite.link')}
            hint={t('share.invite.linkHint', {
              role: t(`projects.roles.${link.role}`),
              days: INVITATION_DAYS,
            })}
          />
        ) : null}

        {problem ? <FieldError>{t(`share.problems.${problem}`)}</FieldError> : null}
      </section>

      {invitations.length > 0 ? (
        <section aria-label={t('share.open.title')} className="flex flex-col gap-2.5">
          <h3 className={SECTION_TITLE}>{t('share.open.title')}</h3>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
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

/** A link that shows only now, with "Kopieren" and what it is good for. */
function LinkBox({ url, label, hint }: { url: string; label: string; hint: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard (e.g. no permission): the field is selected, so it can be copied by hand.
      setCopied(false);
    }
  }

  return (
    <Inset className="flex flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <Input
          readOnly
          value={url}
          aria-label={label}
          className="h-8 flex-1 rounded-full px-3.5 font-mono text-meta"
          onFocus={(event) => {
            event.target.select();
          }}
        />
        <Button
          size="s"
          onClick={() => {
            void copy();
          }}
        >
          {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
          {t(copied ? 'share.invite.copied' : 'share.invite.copy')}
        </Button>
      </div>
      <p className="m-0 px-1 text-small leading-snug text-text-3">{hint}</p>
    </Inset>
  );
}

/**
 * The read-only link of the project (spec 21b): every member sees whether there is one, since
 * their work is visible through it; owners create it, replace it and switch it off.
 */
function ReadOnlyLink({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const { t, i18n } = useTranslation();
  const status = useQuery(shareLinkQuery(projectId)).data;
  const { create, remove } = useShareLinkMutations(projectId);
  /** The link that was just made; it is shown this once. */
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const busy = create.isPending || remove.isPending;
  const since = status?.createdAt
    ? new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short' }).format(
        new Date(status.createdAt),
      )
    : null;

  async function createLink() {
    setFailed(false);
    try {
      setUrl((await create.mutateAsync()).url);
    } catch {
      setFailed(true);
    }
  }

  async function disable() {
    setFailed(false);
    setUrl(null);
    try {
      await remove.mutateAsync();
    } catch {
      setFailed(true);
    }
  }

  return (
    <section aria-label={t('share.readOnly.title')} className="flex flex-col gap-2.5">
      <h3 className={SECTION_TITLE}>{t('share.readOnly.title')}</h3>
      <p className="-mt-1 m-0 text-small leading-snug text-text-3">
        {status === undefined
          ? t('share.readOnly.what')
          : `${
              since ? t('share.readOnly.active', { date: since }) : t('share.readOnly.inactive')
            } ${t('share.readOnly.what')}`}
      </p>
      {canManage && status !== undefined ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={busy}
            title={status.active ? t('share.readOnly.replaceHint') : undefined}
            onClick={() => {
              void createLink();
            }}
          >
            <Link2 size={14} aria-hidden="true" />
            {t(status.active ? 'share.readOnly.replace' : 'share.readOnly.create')}
          </Button>
          {status.active ? (
            <>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  void disable();
                }}
              >
                {t('share.readOnly.disable')}
              </Button>
              <span className="min-w-0 flex-1 text-meta leading-snug text-text-4">
                {t('share.readOnly.replaceHint')}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
      {url ? (
        <LinkBox
          key={url}
          url={url}
          label={t('share.readOnly.link')}
          hint={t('share.readOnly.linkHint')}
        />
      ) : null}
      {failed ? <FieldError>{t('share.problems.failed')}</FieldError> : null}
    </section>
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
    <li className="flex min-h-[52px] min-w-0 items-center gap-2.5 rounded-card bg-bg-subtle py-2 pr-2 pl-2.5 text-small text-text-body">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-bg-panel text-text-3">
        <Icon size={15} aria-hidden="true" />
      </span>
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
    <li className="flex min-h-[52px] min-w-0 items-center gap-3 border-b border-border-subtle py-2 last:border-b-0">
      <Avatar kind="human" size={32} label={member.name} initials={initialsOf(member.name)} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-ui font-medium text-text">{name}</span>
        {member.role === 'editor' && canManage ? (
          <span className="mt-1 flex items-center gap-2 text-meta text-text-3">
            <Checkbox
              id={`${id}-git`}
              checked={member.canApproveGit}
              disabled={busy}
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
            <Select
              size="s"
              value={member.role}
              disabled={busy || roleLocked}
              aria-label={t('share.members.roleOf', { name: member.name })}
              title={roleLocked ? t('share.members.lastOwner') : undefined}
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
            </Select>
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
