import {
  FILE_ACCEPT,
  formatFileSize,
  KNOWLEDGE_NOTE_MAX_LENGTH,
  KNOWLEDGE_URL_MAX_LENGTH,
  MAX_AGENT_KNOWLEDGE,
  MAX_FILE_BYTES,
  webUrlSchema,
  type AgentKnowledgeItem,
} from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { FileText, Link2, Plus, X } from 'lucide-react';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { FieldError, Input } from '@web/components/ui/input';
import {
  agentKnowledgeQuery,
  knowledgeFileUrl,
  useAgentKnowledgeMutations,
} from '@web/features/agents/queries';
import { ApiError } from '@web/lib/api';

type Problem = 'limit' | 'tooLarge' | 'unsupported' | 'invalidLink' | 'failed';

function problemOf(error: unknown): Problem {
  if (!(error instanceof ApiError)) return 'failed';
  if (error.code === 'limit_reached') return 'limit';
  if (error.code === 'too_large') return 'tooLarge';
  if (error.code === 'unsupported_file') return 'unsupported';
  return 'failed';
}

/**
 * The knowledge of a custom agent in its editor (spec 20b, derived look): files and links the
 * agent reads when a question calls for it. Every change applies at once, apart from the form
 * around it.
 */
export function AgentKnowledge({ agentKey }: { agentKey: string }) {
  const { t, i18n } = useTranslation();
  const ids = useId();
  const picker = useRef<HTMLInputElement>(null);
  const items = useQuery(agentKnowledgeQuery(agentKey)).data;
  const { addFile, addLink, remove } = useAgentKnowledgeMutations(agentKey);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const busy = addFile.isPending || addLink.isPending;
  const full = (items?.length ?? 0) >= MAX_AGENT_KNOWLEDGE;

  async function uploadFiles(files: readonly File[]) {
    setProblem(null);
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        setProblem('tooLarge');
        continue;
      }
      try {
        await addFile.mutateAsync(file);
      } catch (error) {
        setProblem(problemOf(error));
        // Nothing more fits, so the remaining files would fail the same way.
        if (problemOf(error) === 'limit') return;
      }
    }
  }

  async function saveLink() {
    setProblem(null);
    const parsed = webUrlSchema.safeParse(url);
    if (!parsed.success) {
      setProblem('invalidLink');
      return;
    }
    try {
      await addLink.mutateAsync({ url: parsed.data, note: note.trim() });
      setUrl('');
      setNote('');
    } catch (error) {
      setProblem(problemOf(error));
    }
  }

  /** Enter adds the link instead of saving the agent. */
  function onLinkKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (url.trim() !== '' && !busy && !full) void saveLink();
  }

  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-1 flex w-full items-baseline gap-2 p-0">
        <span className="text-small font-medium text-text-2">
          {t('agentEditor.knowledge.title')}
        </span>
        <span className="text-meta text-text-4 tabular-nums">
          {t('agentEditor.count', { count: items?.length ?? 0, max: MAX_AGENT_KNOWLEDGE })}
        </span>
      </legend>
      <p className="m-0 text-small leading-snug text-text-3">{t('agentEditor.knowledge.hint')}</p>

      {items && items.length > 0 ? (
        <ul
          aria-label={t('agentEditor.knowledge.title')}
          className="m-0 flex list-none flex-col gap-1 p-0"
        >
          {items.map((item) => (
            <KnowledgeRow
              key={item.id}
              item={item}
              href={item.kind === 'file' ? knowledgeFileUrl(agentKey, item.id) : (item.url ?? '')}
              detail={
                item.kind === 'file'
                  ? item.sizeBytes
                    ? formatFileSize(item.sizeBytes, i18n.language)
                    : ''
                  : item.note
              }
              removeLabel={t('agentEditor.knowledge.remove', {
                name: item.kind === 'file' ? item.name : (item.url ?? item.name),
              })}
              disabled={remove.isPending}
              onRemove={() => {
                setProblem(null);
                remove.mutate(item.id, {
                  onError: () => {
                    setProblem('failed');
                  },
                });
              }}
            />
          ))}
        </ul>
      ) : null}

      {full ? (
        <p className="m-0 text-small text-text-3">
          {t('agentEditor.knowledge.full', { max: MAX_AGENT_KNOWLEDGE })}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={picker}
              type="file"
              multiple
              accept={FILE_ACCEPT}
              className="hidden"
              aria-label={t('agentEditor.knowledge.chooseFile')}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                // The same file can be chosen again after it was removed.
                event.target.value = '';
                if (files.length > 0) void uploadFiles(files);
              }}
            />
            <Button
              size="s"
              disabled={busy}
              onClick={() => {
                picker.current?.click();
              }}
            >
              <Plus size={13} strokeWidth={2.2} aria-hidden="true" />
              {t('agentEditor.knowledge.addFile')}
            </Button>
            <span className="text-meta text-text-4">{t('files.attachHint')}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id={`${ids}-url`}
              type="url"
              inputMode="url"
              value={url}
              maxLength={KNOWLEDGE_URL_MAX_LENGTH}
              placeholder="https://"
              aria-label={t('agentEditor.knowledge.url')}
              className="h-7 min-w-[150px] flex-[3] text-small"
              onKeyDown={onLinkKey}
              onChange={(event) => {
                setUrl(event.target.value);
                setProblem(null);
              }}
            />
            <Input
              id={`${ids}-note`}
              value={note}
              maxLength={KNOWLEDGE_NOTE_MAX_LENGTH}
              placeholder={t('agentEditor.knowledge.notePlaceholder')}
              aria-label={t('agentEditor.knowledge.note')}
              className="h-7 min-w-[120px] flex-[2] text-small"
              onKeyDown={onLinkKey}
              onChange={(event) => {
                setNote(event.target.value);
              }}
            />
            <Button
              size="s"
              disabled={busy || url.trim() === ''}
              onClick={() => {
                void saveLink();
              }}
            >
              <Plus size={13} strokeWidth={2.2} aria-hidden="true" />
              {t('agentEditor.knowledge.addLink')}
            </Button>
          </div>
        </>
      )}

      {problem ? <FieldError>{t(`agentEditor.knowledge.problems.${problem}`)}</FieldError> : null}
    </fieldset>
  );
}

function KnowledgeRow({
  item,
  href,
  detail,
  removeLabel,
  disabled,
  onRemove,
}: {
  item: AgentKnowledgeItem;
  href: string;
  detail: string;
  removeLabel: string;
  disabled: boolean;
  onRemove: () => void;
}) {
  const Icon = item.kind === 'file' ? FileText : Link2;
  return (
    <li className="flex h-[34px] min-w-0 items-center gap-2 rounded-md border border-border-soft bg-bg-muted pr-1 pl-2 text-small text-text-body">
      <Icon size={15} className="shrink-0 text-text-3" aria-hidden="true" />
      <a
        href={href}
        // A file downloads; a link opens in a new tab, without a handle on this window.
        {...(item.kind === 'file'
          ? { download: item.name }
          : { target: '_blank', rel: 'noopener noreferrer' })}
        className="min-w-0 shrink truncate rounded-xs font-medium text-text-body no-underline hover:underline focus-visible:outline-2 focus-visible:outline-ink"
      >
        {item.kind === 'file' ? item.name : (item.url ?? item.name)}
      </a>
      {detail ? (
        <span className="min-w-0 flex-1 truncate text-meta text-text-3 tabular-nums">{detail}</span>
      ) : (
        <span className="flex-1" />
      )}
      <button
        type="button"
        aria-label={removeLabel}
        title={removeLabel}
        disabled={disabled}
        className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-sm text-text-3 hover:bg-bg-subtle hover:text-text focus-visible:outline-2 focus-visible:outline-ink disabled:pointer-events-none disabled:opacity-50"
        onClick={onRemove}
      >
        <X size={13} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </li>
  );
}
