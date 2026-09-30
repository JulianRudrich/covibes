import type { Author } from '@covibes/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { NodeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CanvasActionsProvider, type CanvasActions } from '@web/features/canvas/canvas-actions';
import { BlockNode } from '@web/features/canvas/block-node';
import type { BlockFlowNode, BlockNodeData } from '@web/features/canvas/flow-mapping';
import { aiRing } from '@web/lib/styles';

// The points for arrows need a running React Flow; they are checked in the browser.
vi.mock('@web/features/canvas/connection-handles', () => ({
  ArrowAnchors: () => null,
  ConnectionHandles: () => null,
}));

const NOW = Date.parse('2026-09-29T10:00:00.000Z');
const OLGA: Author = { kind: 'human', userId: '00000000-0000-4000-8000-000000000001' };
const MODERATOR: Author = { kind: 'agent', agentKey: 'moderator' };

function nodeProps(
  data: Partial<BlockNodeData>,
  node: Partial<NodeProps<BlockFlowNode>> = {},
): NodeProps<BlockFlowNode> {
  return {
    id: 'block-1',
    type: 'block',
    data: {
      label: 'API',
      subtitle: 'Dienst',
      blockType: null,
      createdBy: OLGA,
      changedByAgent: null,
      lastChangedAt: new Date(NOW).toISOString(),
      lockedBy: null,
      size: { width: 180, height: 96 },
      ...data,
    },
    dragging: false,
    zIndex: 0,
    selectable: true,
    deletable: true,
    selected: false,
    draggable: true,
    isConnectable: false,
    positionAbsoluteX: 0,
    positionAbsoluteY: 0,
    ...node,
  };
}

function blockActions(overrides: Partial<CanvasActions> = {}): CanvasActions {
  return {
    readOnly: false,
    tool: null,
    beginChange: vi.fn(),
    editingId: null,
    startEditing: vi.fn(),
    finishEditing: vi.fn(),
    finishEdgeEditing: vi.fn(),
    setType: vi.fn(),
    resizeFrame: vi.fn(),
    authorOf: (author) =>
      author.kind === 'agent'
        ? { name: 'Moderator', initials: 'M' }
        : { name: 'Olga Berg', initials: 'OB' },
    ...overrides,
  };
}

/** A change stamped `ageMs` before now. */
function changedAgo(ageMs: number): string {
  return new Date(NOW - ageMs).toISOString();
}

function renderBlock(
  data: Partial<BlockNodeData>,
  node: Partial<NodeProps<BlockFlowNode>> = {},
  actions: CanvasActions = blockActions(),
) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <CanvasActionsProvider value={actions}>{children}</CanvasActionsProvider>
  );
  const view = render(<BlockNode {...nodeProps(data, node)} />, { wrapper });
  const block = view.container.firstElementChild;
  if (!(block instanceof HTMLElement)) throw new Error('The block was not rendered.');
  return { ...view, block, actions };
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

function expectNormal(block: HTMLElement) {
  expect(block).toHaveClass('border', 'border-border-block', 'shadow-block');
  expect(block.style.boxShadow).toBe('');
}

describe('BlockNode', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('anatomy', () => {
    it('shows icon tile, title, subtitle and the author line in the handoff size', () => {
      const { block } = renderBlock({ blockType: 'database', label: 'PostgreSQL' });

      expect(block).toHaveClass('h-[96px]', 'w-[180px]', 'rounded-panel', 'bg-bg-panel');
      expect(block.querySelector('.lucide-database')).toBeInTheDocument();
      expect(screen.getByText('PostgreSQL')).toHaveClass('truncate');
      expect(screen.getByText('Dienst')).toHaveClass('text-text-3');
      expect(screen.getByRole('img', { name: 'Olga Berg' })).toHaveTextContent('OB');
      expect(screen.getByText('Olga Berg')).toHaveClass('text-text-2b');
    });

    it('shows a generic block and types of a later version as a square', () => {
      const { block, unmount } = renderBlock({ blockType: null });
      expect(block.querySelector('.lucide-square')).toBeInTheDocument();
      unmount();

      const later = renderBlock({ blockType: 'queue' });
      expect(later.block.querySelector('.lucide-square')).toBeInTheDocument();
    });

    it('names an agent author with its letter in the agent color', () => {
      renderBlock({ createdBy: MODERATOR });

      expect(screen.getByRole('img', { name: 'Moderator' })).toHaveClass('bg-agent-moderator');
      expect(screen.getByText('Moderator')).toHaveClass('font-medium', 'text-agent-moderator-dark');
    });

    it('leaves out an empty subtitle', () => {
      renderBlock({ subtitle: '' });

      expect(screen.queryByText('Dienst')).not.toBeInTheDocument();
    });
  });

  describe('just changed by AI', () => {
    it('shows border, AI ring and pill in the agent color', () => {
      const { block } = renderBlock({ changedByAgent: 'moderator' });

      expect(block).toHaveClass('border-[1.5px]', 'border-agent-moderator');
      expect(block).not.toHaveClass('border-border-block', 'shadow-block');
      expect(block.style.boxShadow).toBe(aiRing('moderator'));
      const pill = screen.getByText('Gerade gezeichnet');
      expect(pill).toHaveClass('bg-agent-moderator', 'text-on-ink');
      expect(pill).not.toHaveClass('invisible');
      expect(pill.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    });

    it('tints icon tile and subtitle in the agent colors', () => {
      const { block } = renderBlock({ changedByAgent: 'critic' });

      expect(block.querySelector('.lucide-square')?.parentElement).toHaveClass(
        'bg-agent-critic-tint',
        'border-agent-critic-border',
        'text-agent-critic-dark',
      );
      expect(screen.getByText('Dienst')).toHaveClass('text-agent-critic-dark');
    });

    it('returns to normal on its own 5 s after the agent change, with a 200 ms transition', () => {
      const { block } = renderBlock({ changedByAgent: 'moderator' });

      advance(4999);
      expect(block).toHaveClass('border-agent-moderator');

      advance(1);
      expectNormal(block);
      expect(block).toHaveClass('duration-200', 'motion-reduce:transition-none');
      expect(screen.getByText('Gerade gezeichnet')).toHaveClass('invisible', 'opacity-0');
      expect(screen.getByText('Dienst')).toHaveClass('text-text-3');
    });

    it('only shows the rest of the 5 s for an agent change made a moment ago', () => {
      const { block } = renderBlock({ changedByAgent: 'data', lastChangedAt: changedAgo(3000) });
      expect(block).toHaveClass('border-agent-data');

      advance(2000);
      expectNormal(block);
    });

    it('shows nothing for a human change', () => {
      const { block } = renderBlock({ changedByAgent: null });

      expectNormal(block);
      expect(screen.queryByText('Gerade gezeichnet')).not.toBeInTheDocument();
    });

    it('shows nothing for an agent change older than 5 s', () => {
      const { block } = renderBlock({ changedByAgent: 'backend', lastChangedAt: changedAgo(5000) });

      expectNormal(block);
      expect(screen.getByText('Gerade gezeichnet')).toHaveClass('invisible');
      expect(vi.getTimerCount()).toBe(0);
    });

    it('shows the next agent change on the same block again', () => {
      const { block, rerender } = renderBlock({ changedByAgent: 'moderator' });
      advance(5000);
      expectNormal(block);

      advance(10_000);
      rerender(
        <BlockNode
          {...nodeProps({ changedByAgent: 'critic', lastChangedAt: new Date().toISOString() })}
        />,
      );
      expect(block).toHaveClass('border-agent-critic');

      advance(5000);
      expectNormal(block);
    });

    it('ends at once when a human changes the block right after the agent', () => {
      const { block, rerender } = renderBlock({ changedByAgent: 'moderator' });

      advance(1000);
      rerender(
        <BlockNode
          {...nodeProps({ changedByAgent: null, lastChangedAt: new Date().toISOString() })}
        />,
      );

      expectNormal(block);
      expect(screen.queryByText('Gerade gezeichnet')).not.toBeInTheDocument();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('never lasts longer than 5 s when the change is stamped in the future', () => {
      const { block } = renderBlock({
        changedByAgent: 'moderator',
        lastChangedAt: changedAgo(-60_000),
      });
      expect(block).toHaveClass('border-agent-moderator');

      advance(5000);
      expectNormal(block);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('clears its timer when the block goes away', () => {
      const { unmount } = renderBlock({ changedByAgent: 'moderator' });
      expect(vi.getTimerCount()).toBe(1);

      unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('locked', () => {
    it('shows who is editing it, with the lock look and a caret in the title', () => {
      const { block } = renderBlock({ lockedBy: { name: 'Sam' } });

      expect(block).toHaveClass(
        'border-[1.5px]',
        'border-human',
        'bg-bg-locked',
        'shadow-lock',
        'cursor-not-allowed',
      );
      const pill = screen.getByText('Sam bearbeitet');
      expect(pill).toHaveClass('bg-human', 'text-on-ink', '-left-[1.5px]');
      expect(pill.querySelector('.lucide-lock')).toBeInTheDocument();
      expect(block.querySelector('.animate-caret-blink')).toBeInTheDocument();
    });

    it('counts more than an agent change a moment ago', () => {
      const { block } = renderBlock({ lockedBy: { name: 'Sam' }, changedByAgent: 'moderator' });

      expect(block).toHaveClass('border-human');
      expect(block.style.boxShadow).toBe('');
    });

    it('offers no type menu, even when selected', () => {
      renderBlock({ lockedBy: { name: 'Sam' } }, { selected: true });

      expect(
        screen.queryByRole('button', { name: 'Art des Blocks ändern' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('selected', () => {
    it('shows the focus outline', () => {
      const { block } = renderBlock({}, { selected: true });

      expect(block).toHaveClass('outline-2', 'outline-offset-2', 'outline-ink');
    });

    it('opens the type menu from the icon tile and changes the type', () => {
      const { actions } = renderBlock({ blockType: 'server' }, { selected: true });

      fireEvent.keyDown(screen.getByRole('button', { name: 'Art des Blocks ändern' }), {
        key: 'Enter',
      });
      const items = screen.getAllByRole('menuitem');
      expect(items.map((item) => item.textContent)).toEqual([
        'Block',
        'App',
        'Server',
        'Dienst',
        'Datenbank',
        'Repository',
        'Kennzahl',
      ]);
      expect(items[2]?.querySelector('.lucide-check')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('menuitem', { name: 'Datenbank' }));
      expect(actions.setType).toHaveBeenCalledWith('block-1', 'database');
    });

    it('offers no type menu to viewers', () => {
      renderBlock({}, { selected: true }, blockActions({ readOnly: true }));

      expect(
        screen.queryByRole('button', { name: 'Art des Blocks ändern' }),
      ).not.toBeInTheDocument();
    });
  });

  describe('editing', () => {
    function renderEditing() {
      return renderBlock(
        { label: 'API', subtitle: 'Dienst' },
        { selected: true },
        blockActions({ editingId: 'block-1' }),
      );
    }

    it('turns title and subtitle into inputs, with the title focused', () => {
      renderEditing();

      const title = screen.getByRole('textbox', { name: 'Titel' });
      expect(title).toHaveValue('API');
      expect(title).toHaveFocus();
      expect(screen.getByRole('textbox', { name: 'Untertitel' })).toHaveValue('Dienst');
    });

    it('saves with Enter', () => {
      const { actions } = renderEditing();

      const title = screen.getByRole('textbox', { name: 'Titel' });
      fireEvent.change(title, { target: { value: 'Gateway' } });
      fireEvent.keyDown(title, { key: 'Enter' });

      expect(actions.finishEditing).toHaveBeenCalledOnce();
      expect(actions.finishEditing).toHaveBeenCalledWith('block-1', {
        label: 'Gateway',
        subtitle: 'Dienst',
      });
    });

    it('drops the changes with Escape', () => {
      const { actions } = renderEditing();

      const subtitle = screen.getByRole('textbox', { name: 'Untertitel' });
      fireEvent.change(subtitle, { target: { value: 'REST' } });
      fireEvent.keyDown(subtitle, { key: 'Escape' });

      expect(actions.finishEditing).toHaveBeenCalledWith('block-1', null);
    });

    it('saves when the focus leaves the block, but not when it moves to the subtitle', () => {
      const { actions } = renderEditing();
      const title = screen.getByRole('textbox', { name: 'Titel' });
      const subtitle = screen.getByRole('textbox', { name: 'Untertitel' });

      fireEvent.focusOut(title, { relatedTarget: subtitle });
      expect(actions.finishEditing).not.toHaveBeenCalled();

      fireEvent.change(subtitle, { target: { value: 'REST' } });
      fireEvent.focusOut(subtitle, { relatedTarget: document.body });
      expect(actions.finishEditing).toHaveBeenCalledWith('block-1', {
        label: 'API',
        subtitle: 'REST',
      });
    });

    it('keeps keys from reaching the canvas, so Backspace never deletes the block', () => {
      renderEditing();
      const onKeyDown = vi.fn();
      document.addEventListener('keydown', onKeyDown);

      fireEvent.keyDown(screen.getByRole('textbox', { name: 'Titel' }), { key: 'Backspace' });

      expect(onKeyDown).not.toHaveBeenCalled();
      document.removeEventListener('keydown', onKeyDown);
    });
  });
});
