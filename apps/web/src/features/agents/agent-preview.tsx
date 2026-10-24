import { Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import { cn } from '@web/lib/cn';

type AgentPreviewProps = {
  name: string;
  role: string;
  /** One of the six custom colors. */
  color: number;
  /** The glyph of the chosen mark. */
  mark: string;
};

/**
 * The preview of the agent editor (spec 36c, draft G): the agent as it will look in the chat and on
 * the canvas, following every change of name, role, color and mark at once.
 */
export function AgentPreview({ name, role, color, mark }: AgentPreviewProps) {
  const { t } = useTranslation();
  const shownName = name.trim() === '' ? t('agentEditor.preview.unnamed') : name.trim();
  const look = `agent-color-${String(color)}`;
  return (
    <div className={cn('flex h-full flex-col gap-4 px-6 py-7', look)}>
      <span className="text-status font-semibold tracking-[0.02em] text-text-3">
        {t('agentEditor.preview.title')}
      </span>

      <div className="flex items-center gap-3">
        <Avatar kind="agent" agent="custom" mark={mark} size={52} label={shownName} />
        <div className="min-w-0">
          <div className="truncate font-display text-[17px] font-semibold tracking-[-0.01em] text-text">
            {shownName}
          </div>
          <div className="truncate text-small text-text-3">{role.trim()}</div>
        </div>
      </div>

      {/* A message of the agent, like the chat draws it. */}
      <div aria-hidden="true" className="flex items-end gap-2">
        <Avatar kind="agent" agent="custom" mark={mark} size={28} label={shownName} />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="ml-2.5 text-status text-text-3">
            <b className="font-semibold text-agent-custom-dark">{shownName}</b> ·{' '}
            {t('chat.agentBadge')}
          </div>
          <p className="m-0 rounded-[16px] rounded-bl-[5px] bg-agent-custom-tint px-3 py-2 text-ui leading-normal text-text-body">
            {t('agentEditor.preview.message')}
          </p>
        </div>
      </div>

      {/* A block the agent drew, with its author line. */}
      <div
        aria-hidden="true"
        className="flex h-24 w-[180px] flex-col justify-between rounded-panel bg-bg-panel px-3.5 py-3 shadow-block"
      >
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-bg-subtle text-text-2">
            <Square size={15} strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <div className="truncate text-title font-semibold text-text">
              {t('agentEditor.preview.block')}
            </div>
            <div className="truncate text-status text-text-3">
              {t('agentEditor.preview.blockType')}
            </div>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-status font-semibold text-agent-custom-dark">
          <Avatar kind="agent" agent="custom" mark={mark} size={20} label={shownName} />
          <span className="truncate">{shownName}</span>
        </div>
      </div>

      <p className="mt-auto mb-0 text-status leading-normal text-text-3">
        {t('agentEditor.preview.everywhere')}
      </p>
    </div>
  );
}
