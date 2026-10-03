import { ChartGantt } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';

/**
 * "Roadmap" in the plan's toolbar (spec 26a; derived looks): opens the board with the roadmap and
 * brings it into view.
 */
export function RoadmapButton({ busy, onOpen }: { busy: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <Button variant="ghost" size="s" disabled={busy} onClick={onOpen}>
      <ChartGantt size={14} strokeWidth={2} aria-hidden="true" />
      {t('roadmap.button')}
    </Button>
  );
}
