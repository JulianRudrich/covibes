import { useTranslation } from 'react-i18next';

import { DEMO_ACTIVE_PHASE } from '@web/features/workspace/demo-workspace';
import { WorkspaceShell } from '@web/features/workspace/workspace-shell';

/** Route component for `/p/$projectId`. Shows demo data until projects are loaded (spec 04). */
export function WorkspacePage() {
  const { t } = useTranslation();

  return (
    <WorkspaceShell projectName={t('workspace.demoProjectName')} activePhase={DEMO_ACTIVE_PHASE} />
  );
}
