import { workspaceInvitationTokenSchema } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { getRouteApi, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { PageMessage, PageMessageLink } from '@web/components/page-message';
import { Button } from '@web/components/ui/button';
import { Notice } from '@web/components/ui/card';
import { LanguageSwitch } from '@web/features/account/language-switch';
import { sessionQuery } from '@web/features/auth/session';
import { useAcceptWorkspaceInvitation } from '@web/features/workspaces/queries';
import { ApiError } from '@web/lib/api';

const route = getRouteApi('/_authed/workspace-invite/$token');

export function WorkspaceInvitePage() {
  const { t } = useTranslation();
  const { token } = route.useParams();
  const user = useQuery(sessionQuery).data;
  const navigate = useNavigate();
  const accept = useAcceptWorkspaceInvitation();
  const valid = workspaceInvitationTokenSchema.safeParse(token).success;
  const failure = !valid
    ? 'workspaces.invite.unavailable'
    : accept.error instanceof ApiError && accept.error.code === 'forbidden'
      ? 'workspaces.invite.wrongIdentity'
      : accept.error instanceof ApiError &&
          (accept.error.code === 'conflict' || accept.error.code === 'not_found')
        ? 'workspaces.invite.unavailable'
        : 'workspaces.actionFailed';
  return (
    <PageMessage below={<LanguageSwitch />} title={t('workspaces.invite.title')}>
      <p className="m-0 text-body text-text-3">
        {t('workspaces.invite.description', { email: user?.email ?? '' })}
      </p>
      {!valid || accept.isError ? <Notice tone="danger">{t(failure)}</Notice> : null}
      <p className="m-0 text-small text-text-3">{t('workspaces.invite.previewUnavailable')}</p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <PageMessageLink to="/">{t('workspaces.back')}</PageMessageLink>
        {valid ? (
          <Button
            variant="primary"
            size="l"
            disabled={accept.isPending}
            onClick={() => {
              accept.mutate(token, {
                onSuccess: (result) => {
                  void navigate({
                    to: '/',
                    search: { workspace: result.workspaceId },
                    replace: true,
                  });
                },
              });
            }}
          >
            {t(accept.isPending ? 'common.loading' : 'workspaces.invite.accept')}
          </Button>
        ) : null}
      </div>
    </PageMessage>
  );
}
