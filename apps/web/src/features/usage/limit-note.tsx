import { useQuery } from '@tanstack/react-query';
import { Gauge } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { usageStateQuery } from '@web/features/usage/queries';
import { formatUntil } from '@web/lib/format';

/**
 * The note above the composer while a limit of the AI is reached (spec 31a; derived look): the
 * project's month, which holds for everyone, or else the person's own day. It says when the
 * agents answer again and that nothing else pauses. Without a limit it shows nothing.
 */
export function UsageLimitNote({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation();
  const state = useQuery(usageStateQuery(projectId)).data;
  const scope = state?.project.reached ? 'project' : state?.user.reached ? 'user' : null;
  const resetsAt = scope === null ? null : (state?.[scope].resetsAt ?? null);
  // A limit that is reached always says when it is free again.
  if (scope === null || resetsAt === null) return null;

  return (
    <p
      role="status"
      className="m-0 flex items-start gap-2 rounded-panel border border-border-strong bg-bg-muted px-3.5 py-2.5 text-small leading-snug text-text-2"
    >
      <Gauge size={14} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0 text-text-3" />
      <span className="min-w-0">
        {t(`usage.limit.${scope}`, { time: formatUntil(resetsAt, i18n.language) })}
      </span>
    </p>
  );
}
