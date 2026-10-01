import { splitMentions } from '@covibes/shared';

import { agentClass, useAgents, useMentionNames } from '@web/features/agents/agents';
import { splitLinks } from '@web/features/chat/links';
import { cn } from '@web/lib/cn';
import { AGENT_TONE } from '@web/lib/styles';

/**
 * Message text with `@` mentions as inline chips in the agent's colors (handoff: `@Backend`), for
 * the agents in `agents` only (spec 14: a mention of an agent outside the team reaches nobody).
 * Other names stay plain text; line breaks and spaces stay as they were typed. Custom agents
 * (spec 19) are mentioned by their handle, e.g. `@UX-Writer`. Web addresses are links that open in
 * a new tab (spec 20b).
 */
export function MentionText({ text, agents }: { text: string; agents: readonly string[] }) {
  const resolve = useAgents();
  const names = useMentionNames(agents);
  return (
    <span className="whitespace-pre-wrap">
      {splitLinks(text).map((part, partIndex) =>
        part.kind === 'link' ? (
          // Segments are derived from the text alone, so their position is a stable key.
          <a
            key={partIndex}
            href={part.href}
            target="_blank"
            // The page gets no handle on this window and no referrer.
            rel="noopener noreferrer"
            className="rounded-xs text-text underline decoration-border-strong underline-offset-2 wrap-anywhere hover:decoration-text focus-visible:outline-2 focus-visible:outline-ink"
          >
            {part.text}
          </a>
        ) : (
          splitMentions(part.text, names).map((segment, index) =>
            segment.kind === 'mention' ? (
              <span
                key={`${String(partIndex)}-${String(index)}`}
                className={cn(
                  'rounded-xs px-[5px] py-0.5 font-medium',
                  agentClass(AGENT_TONE, resolve(segment.key)),
                )}
              >
                {segment.text}
              </span>
            ) : (
              segment.text
            ),
          )
        ),
      )}
    </span>
  );
}
