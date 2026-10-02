import type { ProjectDetails } from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { Dialog } from '@web/components/ui/dialog';
import { configQuery } from '@web/features/auth/session';
import { ShareDialog } from '@web/features/share/share-dialog';

/** "Teilen" in the header of the open project (spec 21a): opens the share dialog. */
export function ProjectShare({
  project,
  userId,
}: {
  project: Pick<ProjectDetails, 'id' | 'name' | 'role' | 'members'>;
  userId: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const config = useQuery(configQuery).data;
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="primary"
        className="px-3.5"
        onClick={() => {
          setOpen(true);
        }}
      >
        {t('common.share')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? (
          <ShareDialog
            project={project}
            userId={userId}
            emailInvites={config?.emailLogin !== false}
            devMailbox={config?.devMailbox === true}
            onLeft={() => {
              setOpen(false);
              void navigate({ to: '/' });
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}
