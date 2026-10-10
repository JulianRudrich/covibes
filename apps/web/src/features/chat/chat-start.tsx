import { MessagesSquare } from 'lucide-react';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';

/** The first messages the empty chat offers, each to the moderator. */
const CHAT_STARTERS = ['project', 'criteria', 'team'] as const;

/**
 * The chat before its first message (spec 33; derived look): what it is for, and first messages
 * to the moderator. A starter puts its message into the composer for the person to complete; it
 * sends nothing, since a message to an agent costs a run. Viewers read that messages will appear.
 */
export function ChatStart({
  readOnly,
  onStart,
}: {
  readOnly: boolean;
  /** Takes the message of a starter; without it (no moderator to ask) none are offered. */
  onStart?: (message: string) => void;
}) {
  const { t } = useTranslation();
  const hintId = useId();

  if (readOnly) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center p-6 text-center text-ui leading-snug text-text-3">
        {t('empty.chat.viewer')}
      </div>
    );
  }

  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6">
      <div className="flex max-w-[280px] flex-col items-center gap-1.5 text-center">
        <MessagesSquare
          size={24}
          strokeWidth={1.8}
          className="mb-1 text-text-4"
          aria-hidden="true"
        />
        <h3 className="m-0 text-title font-semibold text-text">{t('empty.chat.title')}</h3>
        <p className="m-0 text-ui leading-snug text-text-3">{t('empty.chat.text')}</p>
        {onStart ? (
          <>
            <p id={hintId} className="mt-3 mb-0 text-small leading-snug text-text-3">
              {t('empty.chat.startersHint')}
            </p>
            <div role="group" aria-labelledby={hintId} className="mt-1 flex flex-col gap-1.5">
              {CHAT_STARTERS.map((starter) => (
                <Button
                  key={starter}
                  size="s"
                  onClick={() => {
                    onStart(t(`empty.chat.starters.${starter}.message`));
                  }}
                >
                  {t(`empty.chat.starters.${starter}.label`)}
                </Button>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
