import type { ComponentProps, ReactNode } from 'react';

import { MentionText } from '@web/features/chat/mention-text';

type Props = ComponentProps<typeof MentionText>;
type Block =
  | { kind: 'text' | 'code'; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: string[] };

/** A deliberately small Markdown subset: model output never becomes HTML. */
function messageBlocks(text: string): Block[] {
  const lines = text.split('\n');
  const blocks: Block[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? '';
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      index++;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? ''))
        code.push(lines[index++] ?? '');
      if (index < lines.length) index++;
      blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const list = /^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/.exec(line);
    if (list) {
      const ordered = list[2] !== undefined;
      const items: string[] = [];
      const start = Number(list[2] ?? 1);
      while (index < lines.length) {
        const next = /^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/.exec(lines[index] ?? '');
        if (!next || (next[2] !== undefined) !== ordered) break;
        items.push(next[3] ?? '');
        index++;
      }
      blocks.push({ kind: 'list', ordered, start, items });
      continue;
    }
    const previous = blocks.at(-1);
    if (previous?.kind === 'text') previous.text += `\n${line}`;
    else blocks.push({ kind: 'text', text: line });
    index++;
  }
  return blocks;
}

function inline(props: Props, text: string): ReactNode {
  return text
    .split(/(`[^`\n]+`)/g)
    .map((part, index) =>
      part.startsWith('`') && part.endsWith('`') && part.length > 2 ? (
        <code key={index}>{part.slice(1, -1)}</code>
      ) : (
        <MentionText key={index} {...props} text={part} />
      ),
    );
}

export function FormattedMessage(props: Props) {
  return (
    <>
      {messageBlocks(props.text).map((block, index) => {
        if (block.kind === 'code')
          return (
            <pre key={index} className="max-w-full overflow-x-auto whitespace-pre">
              <code>{block.text}</code>
            </pre>
          );
        if (block.kind === 'list') {
          const items = block.items.map((text, item) => <li key={item}>{inline(props, text)}</li>);
          return block.ordered ? (
            <ol key={index} start={block.start} className="list-decimal pl-5">
              {items}
            </ol>
          ) : (
            <ul key={index} className="list-disc pl-5">
              {items}
            </ul>
          );
        }
        return (
          <span key={index} className="whitespace-pre-wrap">
            {inline(props, block.text)}
          </span>
        );
      })}
    </>
  );
}
