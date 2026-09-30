import { splitMentions, type AgentKey } from '@covibes/shared';

import { cn } from '@web/lib/cn';
import { AGENT_TONE } from '@web/lib/styles';

/**
 * Message text with `@` mentions as inline chips in the agent's colors (handoff: `@Backend`), for
 * the agents in `agents` only (spec 14: a mention of an agent outside the team reaches nobody).
 * Other names stay plain text; line breaks and spaces stay as they were typed.
 */
export function MentionText({ text, agents }: { text: string; agents: readonly AgentKey[] }) {
  return (
    <span className="whitespace-pre-wrap">
      {splitMentions(text).map((segment, index) =>
        segment.kind === 'mention' && agents.includes(segment.key) ? (
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
