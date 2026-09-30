import { MESSAGE_MAX_LENGTH, type AgentKey } from '@covibes/shared';
import { ArrowUp, AtSign, Paperclip } from 'lucide-react';
import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
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
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import { IconButton } from '@web/components/ui/icon-button';
import { Tooltip } from '@web/components/ui/tooltip';

type ComposerProps = {
  /** The agents the `@` menu offers: the project's team (spec 14). */
  agents: readonly AgentKey[];
  /** Receives the trimmed text; empty and whitespace-only messages never arrive here. */
  onSend: (content: string) => void;
  disabled?: boolean;
};

/** Enter that confirms an IME composition (e.g. Japanese input) must not send the message. */
function isComposing(event: KeyboardEvent<HTMLTextAreaElement>) {
  // Safari ends the composition before this keydown and only marks it with keyCode 229.
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- no standard replacement for Safari
  return event.nativeEvent.isComposing || event.keyCode === 229;
}

/**
 * Message input of the chat. Enter sends, Shift+Enter breaks the line, the field grows up to about
 * six lines. "@" offers the agents of the team.
 */
export function Composer({ agents, onSend, disabled = false }: ComposerProps) {
  const { t } = useTranslation();
  const hintId = useId();
  const [draft, setDraft] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Caret behind an inserted mention, applied when the closing menu hands focus back.
  const pendingCaretRef = useRef<number | null>(null);
  const canSend = !disabled && draft.trim() !== '';

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    // Shrink first so deleted lines free their space; the CSS max height caps growth and scrolls.
    textarea.style.height = 'auto';
    textarea.style.height = `${String(textarea.scrollHeight)}px`;
  }, [draft]);

  function send() {
    const content = draft.trim();
    if (disabled || content === '') return;
    onSend(content);
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
      className="flex flex-col rounded-panel border border-border-strong bg-bg-panel shadow-button-secondary transition-shadow has-[textarea:focus]:ring-3 has-[textarea:focus]:ring-focus-soft"
    >
      <textarea
        ref={textareaRef}
        rows={1}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder={t('chat.placeholder')}
        aria-label={t('chat.placeholder')}
        aria-describedby={hintId}
        maxLength={MESSAGE_MAX_LENGTH}
        disabled={disabled}
        className="block max-h-36 min-h-11 w-full resize-none overflow-y-auto rounded-t-panel border-0 bg-transparent px-3.5 py-3 text-body leading-5 text-text outline-none placeholder:text-text-4 disabled:cursor-not-allowed disabled:opacity-50"
      />
      <div className="flex items-center gap-0.5 px-2 pb-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={disabled}>
            <IconButton aria-label={t('chat.mentionAgent')} onFocus={handleMentionTriggerFocus}>
              <AtSign size={15} aria-hidden="true" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {agents.map((agent) => {
              const name = t(`agents.${agent}`);
              return (
                <DropdownMenuItem
                  key={agent}
                  onSelect={() => {
                    insertMention(name);
                  }}
                >
                  {/* The item's text already names the agent. */}
                  <span aria-hidden="true" className="flex">
                    <Avatar
                      kind="agent"
                      agent={agent}
                      size={24}
                      label={name}
                      initials={t(`agentInitials.${agent}`)}
                    />
                  </span>
                  {name}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
        {/* aria-disabled instead of disabled: a disabled button gets neither hover nor focus, so
            its tooltip could never say why it does nothing yet. */}
        <Tooltip content={t('chat.attachLater')} side="top">
          <IconButton
            aria-label={t('chat.attach')}
            aria-disabled="true"
            disabled={disabled}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-text-2b"
          >
            <Paperclip size={15} aria-hidden="true" />
          </IconButton>
        </Tooltip>
        <span id={hintId} className="mr-2 ml-auto text-meta whitespace-nowrap text-text-4">
          {t('chat.enterToSend')}
        </span>
        <Button
          type="submit"
          variant="primary"
          size="s"
          aria-label={t('chat.send')}
          disabled={!canSend}
          className="w-7 px-0"
        >
          <ArrowUp size={14} strokeWidth={2.4} aria-hidden="true" />
        </Button>
      </div>
    </form>
  );
}
