import type { AcceptInvitationResult, InvitationPreview } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageMessage } from '@web/components/page-message';
import { LanguageSwitch } from '@web/features/account/language-switch';
import { Button } from '@web/components/ui/button';
import { Notice } from '@web/components/ui/card';
import { invitationPreviewQuery, useAcceptInvitation } from '@web/features/share/queries';
import { ApiError } from '@web/lib/api';

const route = getRouteApi('/_authed/invite/$token');

/** Why an invitation adds nobody: what became of it, or a link nobody issued. */
type Dead = Exclude<InvitationPreview['status'], 'open' | 'member'> | 'full' | 'unknown';

/**
 * Route component for `/invite/$token` (spec 21a): says who invites to which project with which
 * role and joins on "Beitreten". A link that no longer works says why.
 */
export function InvitePage() {
  const { t } = useTranslation();
  const { token } = route.useParams();
  const navigate = useNavigate();
  const preview = useQuery(invitationPreviewQuery(token));
  const accept = useAcceptInvitation();
  /** What joining came to, if it did not lead into the project. */
  const [outcome, setOutcome] = useState<Dead | 'failed' | null>(null);

  const open = (projectId: string) =>
    navigate({ to: '/p/$projectId', params: { projectId }, replace: true });

  async function join() {
    setOutcome(null);
    let result: AcceptInvitationResult;
    try {
      result = await accept.mutateAsync(token);
    } catch (error) {
      setOutcome(error instanceof ApiError && error.code === 'not_found' ? 'unknown' : 'failed');
      return;
    }
    if (result.projectId) await open(result.projectId);
    else if (result.status !== 'joined' && result.status !== 'member') setOutcome(result.status);
  }

  if (preview.isPending) {
    return (
      <PageMessage below={<LanguageSwitch />} title={t('invite.loading')}>
        <span className="sr-only">{t('common.loading')}</span>
      </PageMessage>
    );
  }

  const unknown = preview.error instanceof ApiError && preview.error.code === 'not_found';
  if (preview.isError && !unknown) {
    return (
      <PageMessage below={<LanguageSwitch />} title={t('invite.loadError')}>
        <BackToProjects />
      </PageMessage>
    );
  }

  const status = preview.data?.status;
  const dead: Dead | null =
    outcome && outcome !== 'failed'
      ? outcome
      : unknown || status === undefined
        ? 'unknown'
        : status === 'open' || status === 'member'
          ? null
          : status;
  if (dead) {
    return (
      <PageMessage below={<LanguageSwitch />} title={t(`invite.dead.${dead}.title`)}>
        <p className="m-0 text-body text-text-3">{t(`invite.dead.${dead}.text`)}</p>
        <BackToProjects />
      </PageMessage>
    );
  }

  const { projectId, projectName, role, invitedBy } = preview.data ?? {};
  if (status === 'member' && projectId) {
    return (
      <PageMessage below={<LanguageSwitch />} title={t('invite.member.title')}>
        <p className="m-0 text-body text-text-3">
          {t('invite.member.text', { project: projectName ?? '' })}
        </p>
        <Button
          variant="primary"
          size="l"
          className="mx-auto mt-3"
          onClick={() => {
            void open(projectId);
          }}
        >
          {t('invite.member.open')}
        </Button>
      </PageMessage>
    );
  }

  return (
    <PageMessage
      below={<LanguageSwitch />}
      title={t('invite.title', { project: projectName ?? '' })}
    >
      <p className="m-0 text-body text-text-3">
        {t('invite.text', {
          name: invitedBy ?? t('invite.someone'),
          role: role ? t(`projects.roles.${role}`) : '',
        })}
      </p>
      <p className="m-0 text-small text-text-3">{role ? t(`invite.roles.${role}`) : null}</p>
      {outcome === 'failed' ? (
        <Notice tone="danger" className="mt-1 text-left">
          {t('invite.failed')}
        </Notice>
      ) : null}
      <div className="mt-3 flex justify-center gap-2">
        <Button
          size="l"
          onClick={() => {
            void navigate({ to: '/' });
          }}
        >
          {t('invite.decline')}
        </Button>
        <Button
          variant="primary"
          size="l"
          disabled={accept.isPending}
          onClick={() => {
            void join();
          }}
        >
          {t('invite.join')}
        </Button>
      </div>
    </PageMessage>
  );
}

function BackToProjects() {
  const { t } = useTranslation();
  return (
    <Link to="/" className="mt-2 text-ui">
      {t('workspace.notFound.back')}
    </Link>
  );
}
