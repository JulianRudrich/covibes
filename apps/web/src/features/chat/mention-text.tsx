import {
  peopleMentionNames,
  PERSON_KEY_PREFIX,
  splitMentions,
  splitReferences,
  type MentionNames,
  type MessageReference,
} from '@covibes/shared';
import { useMemo, type ReactNode } from 'react';

import {
  agentClass,
  useAgents,
  useMentionNames,
  type AgentInfo,
} from '@web/features/agents/agents';
import { splitLinks } from '@web/features/chat/links';
import { ReferenceChip } from '@web/features/chat/reference-chip';
import { cn } from '@web/lib/cn';
import { AGENT_TONE } from '@web/lib/styles';

const NO_PEOPLE: readonly { userId: string; name: string }[] = [];
const NO_REFERENCES: readonly MessageReference[] = [];

/**
 * Message text with `@` mentions as inline chips in the agent's colors (handoff: `@Backend`), for
 * the agents in `agents` only (spec 14: a mention of an agent outside the team reaches nobody).
 * Other names stay plain text; line breaks and spaces stay as they were typed. Custom agents
 * (spec 19) are mentioned by their handle, e.g. `@UX-Writer`. Web addresses are links that open in
 * a new tab (spec 20b). The people a message mentions (spec 22a) get a neutral chip, the reader's
 * own mention a strong one. The elements of the canvas a message refers to by `[Name]` (spec 37a)
 * are inline buttons that lead there.
 */
export function MentionText({
  text,
  agents,
  people = NO_PEOPLE,
  self,
  references = NO_REFERENCES,
  onOpenReference,
}: {
  text: string;
  agents: readonly string[];
  /** The members the message mentions, as the server stored them. */
  people?: readonly { userId: string; name: string }[];
  /** The reader, whose own mention stands out. */
  self?: string;
  /** The elements of the canvas the message refers to, as the server found them. */
  references?: readonly MessageReference[];
  /** Leads to a referenced element; without it a reference is only marked. */
  onOpenReference?: (reference: MessageReference) => void;
}) {
  const resolve = useAgents();
  const agentNames = useMentionNames(agents);
  // Agents first: a name an agent answers to is the agent's.
  const names = useMemo(
    () => ({ ...agentNames, ...peopleMentionNames(people) }),
    [agentNames, people],
  );
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
          splitReferences(part.text, references).map((piece, pieceIndex) => {
            const key = `${String(partIndex)}-${String(pieceIndex)}`;
            return piece.kind === 'reference' ? (
              <ReferenceChip key={key} reference={piece.reference} onOpen={onOpenReference} />
            ) : (
              mentions(piece.text, names, key, resolve, self)
            );
          })
        ),
      )}
    </span>
  );
}

/** A piece of text with its mentions as chips. */
function mentions(
  text: string,
  names: MentionNames,
  key: string,
  resolve: (key: string) => AgentInfo,
  self: string | undefined,
): ReactNode[] {
  return splitMentions(text, names).map((segment, index) =>
    segment.kind === 'mention' ? (
      <span
        key={`${key}-${String(index)}`}
        className={cn(
          'rounded-xs px-[5px] py-0.5 font-medium',
          !segment.key.startsWith(PERSON_KEY_PREFIX)
            ? agentClass(AGENT_TONE, resolve(segment.key))
            : segment.key === `${PERSON_KEY_PREFIX}${self ?? ''}`
              ? 'bg-ink text-on-ink'
              : 'bg-bg-subtle text-text',
        )}
      >
        {segment.text}
      </span>
    ) : (
      segment.text
    ),
  );
}
