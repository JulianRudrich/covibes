import { act, render, screen } from '@testing-library/react';
import type { NodeProps } from '@xyflow/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BlockNode } from '@web/features/canvas/block-node';
import type { BlockFlowNode, BlockNodeData } from '@web/features/canvas/flow-mapping';
import { aiRing } from '@web/lib/styles';

const NOW = Date.parse('2026-09-29T10:00:00.000Z');

function nodeProps(data: Partial<BlockNodeData>): NodeProps<BlockFlowNode> {
  return {
    id: 'block-1',
    type: 'block',
    data: {
      label: 'API',
      subtitle: 'Dienst',
      changedByAgent: null,
      lastChangedAt: new Date(NOW).toISOString(),
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
  };
}

/** A change stamped `ageMs` before now. */
function changedAgo(ageMs: number): string {
  return new Date(NOW - ageMs).toISOString();
}

function renderBlock(data: Partial<BlockNodeData>) {
  const view = render(<BlockNode {...nodeProps(data)} />);
  const block = view.container.firstElementChild;
  if (!(block instanceof HTMLElement)) throw new Error('The block was not rendered.');
  return { ...view, block };
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

  it('shows an agent change as just drawn: border, AI ring and pill in the agent color', () => {
    const { block } = renderBlock({ changedByAgent: 'moderator' });

    expect(block).toHaveClass('border-[1.5px]', 'border-agent-moderator');
    expect(block).not.toHaveClass('border-border-block', 'shadow-block');
    expect(block.style.boxShadow).toBe(aiRing('moderator'));
    const pill = screen.getByText('Gerade gezeichnet');
    expect(pill).toHaveClass('bg-agent-moderator', 'text-on-ink');
    expect(pill).not.toHaveClass('invisible');
    expect(pill.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the title and subtitle in the handoff size while just drawn', () => {
    const { block } = renderBlock({ changedByAgent: 'critic' });

    expect(block).toHaveClass('h-[96px]', 'w-[180px]', 'rounded-panel', 'bg-bg-panel');
    expect(screen.getByText('API')).toBeInTheDocument();
    expect(screen.getByText('Dienst')).toBeInTheDocument();
    expect(screen.getByText('Gerade gezeichnet')).toHaveClass('bg-agent-critic');
  });

  it('returns to normal on its own 5 s after the agent change, with a 200 ms transition', () => {
    const { block } = renderBlock({ changedByAgent: 'moderator' });

    advance(4999);
    expect(block).toHaveClass('border-agent-moderator');

    advance(1);
    expectNormal(block);
    expect(block).toHaveClass('duration-200', 'motion-reduce:transition-none');
    expect(screen.getByText('Gerade gezeichnet')).toHaveClass('invisible', 'opacity-0');
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
