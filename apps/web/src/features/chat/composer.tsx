import {
  FILE_ACCEPT,
  formatFileSize,
  memberHandle,
  MESSAGE_MAX_LENGTH,
  referenceNames,
  type MessageAttachment,
  type NamedElement,
} from '@covibes/shared';
import { ArrowUp, AtSign, FileText, LoaderCircle, Paperclip, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type SubmitEvent,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { Avatar } from '@web/components/ui/avatar';
import { Button } from '@web/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import { IconButton } from '@web/components/ui/icon-button';
import { Tooltip } from '@web/components/ui/tooltip';
import { AgentAvatar } from '@web/features/agents/agent-avatar';
import type { Uploads } from '@web/features/files/use-uploads';
import { useAgents } from '@web/features/agents/agents';
import { initialsOf } from '@web/lib/format';

type ComposerProps = {
  /** The agents the `@` menu offers: the project's team (spec 14), by key. */
  agents: readonly string[];
  /** The other members, offered below the agents (spec 22a). */
  people?: readonly { userId: string; name: string }[];
  /**
   * Receives the trimmed text, the uploaded files to take along and the elements of the canvas
   * the text was asked to refer to (spec 37b); empty and whitespace-only messages never arrive
   * here.
   */
  onSend: (
    content: string,
    attachments: readonly MessageAttachment[],
    references: readonly NamedElement[],
  ) => void;
  /** The files of the message being written (spec 20a); without it nothing can be attached. */
  uploads?: Uploads;
  disabled?: boolean;
  /**
   * A message to start from (spec 33), e.g. one the empty chat offers: it goes into the field
   * for the person to complete and send. A new `key` puts it there again.
   */
  start?: { key: number; text: string };
  /**
   * An element of the canvas to ask about (spec 37b): its name goes into the text in square
   * brackets, at the caret, and the message says which element is meant. A new object inserts
   * again.
   */
  ask?: NamedElement & { label: string };
};

const NO_PEOPLE: readonly { userId: string; name: string }[] = [];

/** The round 40 px buttons inside the pill. */
const COMPOSER_BUTTON = 'size-10 text-text-2';

/** Enter that confirms an IME composition (e.g. Japanese input) must not send the message. */
function isComposing(event: KeyboardEvent<HTMLTextAreaElement>) {
  // Safari ends the composition before this keydown and only marks it with keyCode 229.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- no standard replacement for Safari
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/**
 * Message input of the chat. Enter sends, Shift+Enter breaks the line, the field grows up to about
 * six lines. "@" offers the agents of the team; the paperclip attaches files, and images can be
 * pasted (spec 20a). Files upload at once and show as chips above the text.
 */
export function Composer({
  agents,
  people = NO_PEOPLE,
  onSend,
  uploads,
  disabled = false,
  start,
  ask,
}: ComposerProps) {
  const { t, i18n } = useTranslation();
  const resolve = useAgents();
  // A member is mentioned by the handle of their name; one without letters or digits cannot be.
  const mentionable = people
    .map((person) => ({ ...person, handle: memberHandle(person.name) }))
    .filter((person) => person.handle !== '');
  const hintId = useId();
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // A message to start from replaces what is in the field, once per key.
  const [started, setStarted] = useState<number | undefined>(undefined);
  if (start && start.key !== started) {
    setStarted(start.key);
    setDraft(start.text.slice(0, MESSAGE_MAX_LENGTH));
  }
  // Writing goes on behind it.
  useEffect(() => {
    const textarea = textareaRef.current;
    if (started === undefined || !textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, [started]);
  // Caret behind an inserted mention, applied when the closing menu hands focus back.
  const pendingCaretRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // A message waits for its files; it still needs text.
  const canSend = !disabled && draft.trim() !== '' && uploads?.uploading !== true;

  // The elements of the canvas this message was asked to refer to (spec 37b), by the name the
  // text writes for them. They go along when the message is sent, as far as the text still
  // names them.
  const namedRef = useRef(new Map<string, NamedElement>());
  // Caret behind an inserted reference, applied once the text holds it.
  const afterReferenceRef = useRef<number | null>(null);
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!ask || !textarea) return;
    const current = textarea.value;
    const { selectionStart, selectionEnd } = textarea;
    const before = current.slice(0, selectionStart);
    // Glued to a word, the bracket would read as part of it.
    const reference = `${before === '' || /\s$/.test(before) ? '' : ' '}[${ask.label}] `;
    const next = before + reference + current.slice(selectionEnd);
    if (next.length > MESSAGE_MAX_LENGTH) return;
    namedRef.current.set(ask.label.toLowerCase(), { boardId: ask.boardId, nodeId: ask.nodeId });
    afterReferenceRef.current = selectionStart + reference.length;
    setDraft(next);
  }, [ask]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    // Shrink first so deleted lines free their space; the CSS max height caps growth and scrolls.
    textarea.style.height = 'auto';
    // An empty field keeps one line; a long placeholder must not make it grow.
    if (draft !== '') textarea.style.height = `${String(textarea.scrollHeight)}px`;
    // Writing goes on behind a reference that was just inserted.
    const caret = afterReferenceRef.current;
    if (caret !== null) {
      afterReferenceRef.current = null;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
    }
  }, [draft]);

  function send() {
    const content = draft.trim();
    if (!canSend || content === '') return;
    const named = referenceNames(content).flatMap((name) => {
      const element = namedRef.current.get(name.toLowerCase());
      return element ? [element] : [];
    });
    onSend(content, uploads?.attachments ?? [], named);
    namedRef.current.clear();
    uploads?.clear();
    setDraft('');
    textareaRef.current?.focus();
  }

  function handleSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    send();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || isComposing(event)) return;
    event.preventDefault();
    send();
  }

  /** Files in the clipboard (e.g. a screenshot) are attached; text is pasted as usual. */
  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (!uploads || files.length === 0) return;
    event.preventDefault();
    uploads.add(files);
  }

  function insertMention(name: string) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? draft.length;
    const end = textarea?.selectionEnd ?? draft.length;
    const before = draft.slice(0, start);
    // Glued to a word, `@name` reads like an email address and would not count as a mention.
    const mention = `${before === '' || /\s$/.test(before) ? '' : ' '}@${name} `;
    const next = before + mention + draft.slice(end);
    if (next.length > MESSAGE_MAX_LENGTH) return;
    setDraft(next);
    pendingCaretRef.current = start + mention.length;
  }

  // The menu returns focus to its trigger on close; after a mention, writing goes on in the text.
  function handleMentionTriggerFocus() {
    const caret = pendingCaretRef.current;
    const textarea = textareaRef.current;
    if (caret === null || !textarea) return;
    pendingCaretRef.current = null;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
  }

  return (
    <form
      onSubmit={handleSubmit}
      // A pill of 52 px that keeps its radius while the text grows (handoff "Composer").
      className="flex flex-col rounded-[26px] bg-bg-subtle inset-ring inset-ring-border transition-shadow has-[textarea:focus]:inset-ring-border-strong has-[textarea:focus]:ring-3 has-[textarea:focus]:ring-focus-soft"
    >
      {uploads && uploads.items.length > 0 ? (
        <ul
          aria-label={t('files.attached')}
          className="m-0 flex list-none flex-wrap gap-1.5 px-3 pt-3"
        >
          {uploads.items.map((item) => (
            <li
              key={item.localId}
              className="flex h-7 max-w-full items-center gap-1.5 rounded-full bg-bg-panel pr-0.5 pl-2.5 text-small text-text-body inset-ring inset-ring-border"
            >
              {item.status === 'uploading' ? (
                <LoaderCircle
                  size={13}
                  className="shrink-0 animate-spin text-text-3 motion-reduce:animate-none"
                  aria-label={t('files.uploading')}
                />
              ) : (
                <FileText size={13} className="shrink-0 text-text-3" aria-hidden="true" />
              )}
              <span className="min-w-0 truncate font-medium">{item.name}</span>
              <span className="shrink-0 text-meta text-text-3 tabular-nums">
                {formatFileSize(item.sizeBytes, i18n.language)}
              </span>
              <IconButton
                aria-label={t('files.remove', { name: item.name })}
                className="size-6"
                onClick={() => {
                  uploads.remove(item.localId);
                }}
              >
                <X size={13} aria-hidden="true" />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-end gap-0.5 px-1.5 py-1.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <IconButton
              aria-label={t('chat.mentionAgent')}
              className={COMPOSER_BUTTON}
              onFocus={handleMentionTriggerFocus}
            >
              <AtSign size={17} strokeWidth={1.9} aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {agents.map((key) => {
              const agent = resolve(key);
              return (
                <DropdownMenuItem
                  key={key}
                  onSelect={() => {
                    // A custom agent is mentioned by its handle, e.g. "UX-Writer" (spec 19).
                    insertMention(agent.mention);
                  }}
                >
                  {/* The item's text already names the agent. */}
                  <span aria-hidden="true" className="flex">
                    <AgentAvatar agent={agent} size={24} />
                  </span>
                  {agent.name}
                </DropdownMenuItem>
              );
            })}
            {mentionable.length > 0 ? (
              <DropdownMenuLabel>{t('chat.mentionPeople')}</DropdownMenuLabel>
            ) : null}
            {mentionable.map((person) => (
              <DropdownMenuItem
                key={person.userId}
                onSelect={() => {
                  insertMention(person.handle);
                }}
              >
                <span aria-hidden="true" className="flex">
                  <Avatar
                    kind="human"
                    size={24}
                    label={person.name}
                    initials={initialsOf(person.name)}
                  />
                </span>
                {person.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.placeholder')}
          aria-describedby={hintId}
          maxLength={MESSAGE_MAX_LENGTH}
          disabled={disabled}
          // Ten lines of text at 20 px between 40 px buttons, then it scrolls.
          className="block max-h-36 min-h-10 min-w-0 flex-1 resize-none self-center overflow-y-auto border-0 bg-transparent py-2.5 text-[14px] leading-5 text-text outline-none placeholder:text-text-3 placeholder-shown:overflow-hidden placeholder-shown:text-ellipsis placeholder-shown:whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
        />
        {uploads ? (
          <>
            <Tooltip content={t('files.attachHint')} side="top">
              <IconButton
                aria-label={t('chat.attach')}
                className={COMPOSER_BUTTON}
                disabled={disabled}
                onClick={() => {
                  fileInputRef.current?.click();
                }}
              >
                <Paperclip size={17} strokeWidth={1.9} aria-hidden="true" />
              </IconButton>
            </Tooltip>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept={FILE_ACCEPT}
              aria-label={t('files.choose')}
              className="hidden"
              onChange={(event) => {
                uploads.add(Array.from(event.target.files ?? []));
                // The same file can be chosen again after it was taken off.
                event.target.value = '';
              }}
            />
          </>
        ) : null}
        {/* Read to screen readers only: the pill has no room for it (handoff "Composer"). */}
        <span id={hintId} className="sr-only">
          {t('chat.enterToSend')}
        </span>
        <Button
          type="submit"
          variant="primary"
          aria-label={t('chat.send')}
          disabled={!canSend}
          className="size-10 px-0"
        >
          <ArrowUp size={16} strokeWidth={2.3} aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}
