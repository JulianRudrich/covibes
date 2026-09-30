import type { AgentKey } from '@covibes/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '@web/components/ui/tooltip';
import { Composer } from '@web/features/chat/composer';

function renderComposer({
  disabled,
  agents = ['moderator', 'backend', 'critic', 'data'],
}: { disabled?: boolean; agents?: AgentKey[] } = {}) {
  const onSend = vi.fn<(content: string) => void>();
  render(
    <TooltipProvider>
      <Composer agents={agents} onSend={onSend} disabled={disabled} />
    </TooltipProvider>,
  );
  const textbox = screen.getByRole<HTMLTextAreaElement>('textbox', {
    name: 'Nachricht an Team und Agents, @ ruft einen Agent',
  });
  return { onSend, textbox };
}

function type(textbox: HTMLTextAreaElement, value: string) {
  fireEvent.change(textbox, { target: { value } });
}

function sendButton() {
  return screen.getByRole('button', { name: 'Senden' });
}

async function chooseAgent(name: string) {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Agent erwähnen' }), { key: 'Enter' });
  fireEvent.click(await screen.findByRole('menuitem', { name }));
}

describe('Composer', () => {
  it('sends the trimmed text on Enter, then clears the field and keeps focus', () => {
    const { onSend, textbox } = renderComposer();

    type(textbox, '  Hallo Team  ');
    fireEvent.keyDown(textbox, { key: 'Enter' });

    expect(onSend).toHaveBeenCalledExactlyOnceWith('Hallo Team');
    expect(textbox).toHaveValue('');
    expect(textbox).toHaveFocus();
  });

  it('lets Shift+Enter insert a line break instead of sending', () => {
    const { onSend, textbox } = renderComposer();

    type(textbox, 'Erste Zeile');
    // fireEvent returns false when the handler prevented the default (the line break).
    const lineBreak = fireEvent.keyDown(textbox, { key: 'Enter', shiftKey: true });

    expect(lineBreak).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
    expect(textbox).toHaveValue('Erste Zeile');
  });

  it('ignores empty and whitespace-only text', () => {
    const { onSend, textbox } = renderComposer();

    fireEvent.keyDown(textbox, { key: 'Enter' });
    type(textbox, '  \n  ');
    fireEvent.keyDown(textbox, { key: 'Enter' });

    expect(onSend).not.toHaveBeenCalled();
    expect(sendButton()).toBeDisabled();
  });

  it('does not send while an IME composition is confirmed with Enter', () => {
    const { onSend, textbox } = renderComposer();

    type(textbox, 'にほんご');
    fireEvent.keyDown(textbox, { key: 'Enter', isComposing: true });
    // Safari reports the confirming Enter after compositionend, only marked by keyCode 229.
    fireEvent.keyDown(textbox, { key: 'Enter', keyCode: 229 });

    expect(onSend).not.toHaveBeenCalled();
    expect(textbox).toHaveValue('にほんご');
  });

  it('sends with the send button, which is disabled while the text is empty', () => {
    const { onSend, textbox } = renderComposer();
    expect(sendButton()).toBeDisabled();

    type(textbox, 'Klingt gut');
    expect(sendButton()).toBeEnabled();
    fireEvent.click(sendButton());

    expect(onSend).toHaveBeenCalledExactlyOnceWith('Klingt gut');
    expect(textbox).toHaveValue('');
    expect(textbox).toHaveFocus();
    expect(sendButton()).toBeDisabled();
  });

  it('offers only the agents of the team under "@" (spec 14)', async () => {
    renderComposer({ agents: ['moderator', 'ml'] });

    fireEvent.keyDown(screen.getByRole('button', { name: 'Agent erwähnen' }), { key: 'Enter' });

    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['MModerator', 'MLML']);
  });

  it('offers the four agents under "@"', async () => {
    renderComposer();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Agent erwähnen' }), { key: 'Enter' });

    const items = await screen.findAllByRole('menuitem');
    expect(items).toHaveLength(4);
    // The avatar is decorative, so each item is named by the agent alone.
    ['Moderator', 'Backend', 'Kritiker', 'Daten'].forEach((name, index) => {
      expect(items[index]).toHaveAccessibleName(name);
    });
  });

  it('inserts the chosen agent at the caret and returns focus behind it', async () => {
    const { textbox } = renderComposer();
    type(textbox, 'Was meint dazu?');
    textbox.setSelectionRange(10, 10);

    await chooseAgent('Kritiker');

    expect(textbox).toHaveValue('Was meint @Kritiker dazu?');
    await waitFor(() => {
      expect(textbox).toHaveFocus();
    });
    expect(textbox.selectionStart).toBe(20);
    expect(textbox.selectionEnd).toBe(20);
  });

  it('separates a mention from a word right before the caret', async () => {
    const { textbox } = renderComposer();
    type(textbox, 'Hallo');

    await chooseAgent('Moderator');

    expect(textbox).toHaveValue('Hallo @Moderator ');
  });

  it('shows "Attach" as unavailable with a tooltip that explains why', async () => {
    renderComposer();
    const attach = screen.getByRole('button', { name: 'Datei anhängen' });

    expect(attach).toHaveAttribute('aria-disabled', 'true');
    act(() => {
      attach.focus();
    });

    expect(attach).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Anhänge kommen später.');
  });

  it('disables everything while disabled', () => {
    const { onSend, textbox } = renderComposer({ disabled: true });

    expect(textbox).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Agent erwähnen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Datei anhängen' })).toBeDisabled();
    expect(sendButton()).toBeDisabled();

    fireEvent.keyDown(textbox, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });
});
