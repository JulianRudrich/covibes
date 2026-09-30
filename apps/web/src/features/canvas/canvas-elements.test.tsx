import { FRAME_SIZE, NOTE_SIZE, type Author } from '@covibes/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import type { EdgeProps, NodeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CanvasArrow } from '@web/features/canvas/canvas-arrow';
import { CanvasActionsProvider, type CanvasActions } from '@web/features/canvas/canvas-actions';
import type { ArrowFlowEdge, FrameFlowNode, NoteFlowNode } from '@web/features/canvas/flow-mapping';
import { FrameNode } from '@web/features/canvas/frame-node';
import { NoteNode } from '@web/features/canvas/note-node';

// Resize handles and the edge layer need a running React Flow; they are checked in the browser.
vi.mock('@xyflow/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@xyflow/react')>()),
  NodeResizer: () => null,
  BaseEdge: ({ path, markerEnd, style }: { path: string; markerEnd: string; style: object }) => (
    <svg>
      <path data-testid="arrow" d={path} markerEnd={markerEnd} style={style} />
    </svg>
  ),
  EdgeLabelRenderer: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

const NOW = Date.parse('2026-09-30T10:00:00.000Z');
const ALEX: Author = { kind: 'human', userId: '00000000-0000-4000-8000-000000000001' };

function canvasActions(overrides: Partial<CanvasActions> = {}): CanvasActions {
  return {
    readOnly: false,
    tool: null,
    beginChange: vi.fn(),
    editingId: null,
    startEditing: vi.fn(),
    finishEditing: vi.fn(),
    finishEdgeEditing: vi.fn(),
    setType: vi.fn(),
    setDiagramType: vi.fn(),
    resizeFrame: vi.fn(),
    authorOf: (author) =>
      author.kind === 'agent'
        ? { name: 'Moderator', initials: 'M' }
        : { name: 'Alex', initials: 'A' },
    ...overrides,
  };
}

function withActions(actions: CanvasActions) {
  return ({ children }: { children: ReactNode }) => (
    <CanvasActionsProvider value={actions}>{children}</CanvasActionsProvider>
  );
}

const nodeBase = {
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

const common = {
  createdBy: ALEX,
  changedByAgent: null,
  lastChangedAt: new Date(NOW).toISOString(),
  lockedBy: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('NoteNode', () => {
  function renderNote(
    data: Partial<NoteFlowNode['data']> = {},
    actions: CanvasActions = canvasActions(),
  ) {
    const props: NodeProps<NoteFlowNode> = {
      ...nodeBase,
      id: 'note-1',
      type: 'sticky',
      data: { ...common, label: 'Offline-Modus?', size: NOTE_SIZE, ...data },
    };
    const view = render(<NoteNode {...props} />, { wrapper: withActions(actions) });
    const note = view.container.firstElementChild;
    if (!(note instanceof HTMLElement)) throw new Error('The note was not rendered.');
    return { note, actions };
  }

  it('looks like the handoff: yellow, rotated, with its creator in the footer', () => {
    const { note } = renderNote();

    expect(note).toHaveClass(
      'h-[124px]',
      'w-[176px]',
      '-rotate-[1.5deg]',
      'bg-note',
      'border-note-border',
      'shadow-note',
      'rounded-[4px_4px_14px_4px]',
    );
    expect(screen.getByText('Offline-Modus?')).toHaveClass('text-display', 'text-note-text');
    expect(screen.getByText('Notiz · Alex')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Alex' })).toHaveClass('bg-note-avatar');
  });

  it('shows who is editing it', () => {
    const { note } = renderNote({ lockedBy: { name: 'Sam' } });

    expect(note).toHaveClass('border-human', 'cursor-not-allowed');
    expect(screen.getByText('Sam bearbeitet')).toBeInTheDocument();
  });

  it('marks an agent change as just drawn', () => {
    const { note } = renderNote({ changedByAgent: 'moderator' });

    expect(note).toHaveClass('border-agent-moderator');
    expect(screen.getByText('Gerade gezeichnet')).not.toHaveClass('invisible');
  });

  it('edits its text in place and saves with Enter', () => {
    const { actions } = renderNote({}, canvasActions({ editingId: 'note-1' }));

    const text = screen.getByRole('textbox', { name: 'Text der Notiz' });
    expect(text).toHaveFocus();
    fireEvent.change(text, { target: { value: 'Offline später' } });
    fireEvent.keyDown(text, { key: 'Enter' });

    expect(actions.finishEditing).toHaveBeenCalledWith('note-1', { label: 'Offline später' });
  });
});

describe('FrameNode', () => {
  function renderFrame(
    data: Partial<FrameFlowNode['data']> = {},
    actions: CanvasActions = canvasActions(),
  ) {
    const props: NodeProps<FrameFlowNode> = {
      ...nodeBase,
      id: 'frame-1',
      type: 'frame',
      data: {
        ...common,
        label: 'Architektur',
        size: FRAME_SIZE,
        blockCount: 5,
        diagramType: null,
        ...data,
      },
    };
    const view = render(<FrameNode {...props} />, { wrapper: withActions(actions) });
    const frame = view.container.firstElementChild;
    if (!(frame instanceof HTMLElement)) throw new Error('The frame was not rendered.');
    return { frame, actions };
  }

  it('shows title and the number of its blocks as in the handoff', () => {
    const { frame } = renderFrame();

    expect(frame).toHaveClass('rounded-frame', 'border-frame-border', 'bg-bg-panel/55');
    expect(screen.getByText('Architektur')).toHaveClass('truncate');
    expect(screen.getByText('5 Blöcke')).toHaveClass('text-status', 'text-text-3');
    expect(frame.querySelector('.lucide-frame')).toBeInTheDocument();
  });

  it('counts one block in the singular', () => {
    renderFrame({ blockCount: 1 });

    expect(screen.getByText('1 Block')).toBeInTheDocument();
  });

  it('shows its diagram type with icon and name', () => {
    const { frame } = renderFrame({ label: 'Nutzer und Projekte', diagramType: 'datamodel' });

    expect(screen.getByText('Datenmodell · 5 Blöcke')).toHaveClass('text-text-3');
    expect(frame.querySelector('.lucide-table-properties')).toBeInTheDocument();
    expect(frame.querySelector('.lucide-frame')).not.toBeInTheDocument();
  });

  it('shows a type from a later version as a free frame', () => {
    const { frame } = renderFrame({ diagramType: 'roadmap' });

    expect(screen.getByText('5 Blöcke')).toBeInTheDocument();
    expect(frame.querySelector('.lucide-frame')).toBeInTheDocument();
  });

  it('changes the diagram type from the icon of a selected frame', () => {
    const actions = canvasActions();
    const { unmount } = render(
      <FrameNode
        {...{
          ...nodeBase,
          id: 'frame-1',
          type: 'frame',
          data: { ...common, label: 'Ideen', size: FRAME_SIZE, blockCount: 2, diagramType: null },
        }}
      />,
      { wrapper: withActions(actions) },
    );
    // Only a selected frame offers the menu.
    expect(screen.queryByRole('button', { name: 'Diagrammtyp ändern' })).not.toBeInTheDocument();
    unmount();

    render(
      <FrameNode
        {...{
          ...nodeBase,
          id: 'frame-1',
          type: 'frame',
          selected: true,
          data: {
            ...common,
            label: 'Ideen',
            size: FRAME_SIZE,
            blockCount: 2,
            diagramType: 'mindmap',
          },
        }}
      />,
      { wrapper: withActions(actions) },
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Diagrammtyp ändern' }), {
      key: 'Enter',
    });
    const items = screen.getAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Freier Rahmen',
      'Mindmap',
      'Architektur',
      'Datenmodell',
      'Ablauf',
      'Sitemap',
    ]);
    expect(items[1]?.querySelector('.lucide-check')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Ablauf' }));
    expect(actions.setDiagramType).toHaveBeenCalledWith('frame-1', 'flow');
  });

  it('edits its title in place and drops the change with Escape', () => {
    const { actions } = renderFrame({}, canvasActions({ editingId: 'frame-1' }));

    const title = screen.getByRole('textbox', { name: 'Titel des Rahmens' });
    fireEvent.change(title, { target: { value: 'Daten' } });
    fireEvent.keyDown(title, { key: 'Escape' });

    expect(actions.finishEditing).toHaveBeenCalledWith('frame-1', null);
  });
});

describe('CanvasArrow', () => {
  const geometry = {
    path: 'M 0 0 C 0 50, 100 50, 100 100',
    label: { x: 50, y: 50 },
    source: { x: 0, y: 0 },
    target: { x: 100, y: 100 },
  };

  function renderArrow(
    data: Partial<NonNullable<ArrowFlowEdge['data']>> = {},
    edge: Partial<EdgeProps<ArrowFlowEdge>> = {},
    actions: CanvasActions = canvasActions(),
  ) {
    const props = {
      id: 'edge-1',
      source: 'a',
      target: 'b',
      sourceX: 0,
      sourceY: 0,
      targetX: 100,
      targetY: 100,
      sourcePosition: 'bottom',
      targetPosition: 'top',
      selected: false,
      data: {
        label: 'REST',
        changedByAgent: null,
        lastChangedAt: new Date(NOW).toISOString(),
        geometry,
        ...data,
      },
      ...edge,
    } as EdgeProps<ArrowFlowEdge>;
    render(<CanvasArrow {...props} />, { wrapper: withActions(actions) });
    return { arrow: screen.getByTestId('arrow'), actions };
  }

  it('draws the curve in the edge color with a filled head and a mono label', () => {
    const { arrow } = renderArrow();

    expect(arrow).toHaveAttribute('d', geometry.path);
    expect(arrow).toHaveAttribute('marker-end', 'url(#covibes-arrowhead-edge)');
    expect(arrow.style.stroke).toBe('var(--color-edge)');
    expect(arrow.style.strokeWidth).toBe('1.5');
    expect(screen.getByText('REST')).toHaveClass('font-mono', 'text-badge', 'border-border-float');
  });

  it('shows an agent change in the agent color at 1.75 px, also on the label', () => {
    const { arrow } = renderArrow({ changedByAgent: 'moderator' });

    expect(arrow).toHaveAttribute('marker-end', 'url(#covibes-arrowhead-moderator)');
    expect(arrow.style.stroke).toBe('var(--color-agent-moderator)');
    expect(arrow.style.strokeWidth).toBe('1.75');
    expect(screen.getByText('REST')).toHaveClass(
      'bg-agent-moderator-tint-2',
      'border-agent-moderator-border-2',
      'text-agent-moderator-dark',
    );
  });

  it('is graphite while selected', () => {
    const { arrow } = renderArrow({}, { selected: true });

    expect(arrow.style.stroke).toBe('var(--color-ink)');
  });

  it('shows no pill without a label', () => {
    renderArrow({ label: '' });

    expect(screen.queryByText('REST')).not.toBeInTheDocument();
  });

  it('edits the label in place', () => {
    const { actions } = renderArrow({}, {}, canvasActions({ editingId: 'edge-1' }));

    const input = screen.getByRole('textbox', { name: 'Beschriftung' });
    fireEvent.change(input, { target: { value: 'SQL' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(actions.finishEdgeEditing).toHaveBeenCalledWith('edge-1', 'SQL');
  });
});
