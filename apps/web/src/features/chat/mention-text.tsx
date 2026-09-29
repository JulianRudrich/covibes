import { splitMentions } from '@covibes/shared';

import { cn } from '@web/lib/cn';
import { AGENT_TONE } from '@web/lib/styles';

/**
 * Message text with `@` mentions of known agents as inline chips in the agent's colors (handoff:
 * `@Backend`). Unknown names stay plain text; line breaks and spaces stay as they were typed.
 */
export function MentionText({ text }: { text: string }) {
  return (
    <span className="whitespace-pre-wrap">
      {splitMentions(text).map((segment, index) =>
        segment.kind === 'mention' ? (
          // Segments are derived from the text alone, so their position is a stable key.
          <span
            key={index}
            className={cn('rounded-xs px-[5px] py-0.5 font-medium', AGENT_TONE[segment.key])}
          >
            {segment.text}
          </span>
        ) : (
          segment.text
        ),
      )}
    </span>
  );
}
