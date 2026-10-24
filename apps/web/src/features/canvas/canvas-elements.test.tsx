import { FRAME_SIZE, NOTE_SIZE, type Author, type Roadmap } from '@covibes/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { EdgeProps, NodeProps } from '@xyflow/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CanvasArrow } from '@web/features/canvas/canvas-arrow';
import { CanvasActionsProvider, type CanvasActions } from '@web/features/canvas/canvas-actions';
import type { ArrowFlowEdge, FrameFlowNode, NoteFlowNode } from '@web/features/canvas/flow-mapping';
import { FrameNode } from '@web/features/canvas/frame-node';
import { NoteNode } from '@web/features/canvas/note-node';
import { RoadmapProvider } from '@web/features/roadmap/roadmap-context';
import { createQueryClient } from '@web/lib/query-client';
import { aiRing } from '@web/lib/styles';

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
      '-rotate-2',
      'bg-note',
      'shadow-note',
      'rounded-[6px_6px_22px_6px]',
    );
    expect(screen.getByText('Offline-Modus?')).toHaveClass(
      'font-display',
      'text-heading',
      'text-note-text',
    );
    expect(screen.getByText('Notiz · Alex')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Alex' })).toHaveClass('bg-note-avatar');
  });

  it('shows who is editing it', () => {
    const { note } = renderNote({ lockedBy: { name: 'Sam' } });

    expect(note).toHaveClass('shadow-lock', 'cursor-not-allowed');
    expect(screen.getByText('Sam bearbeitet')).toBeInTheDocument();
  });

  it('marks an agent change as just drawn', () => {
    const { note } = renderNote({ changedByAgent: 'moderator' });

    expect(note.style.boxShadow).toBe(aiRing({ look: 'moderator', color: null }));
    expect(note.querySelector('.animate-ring')).toBeInTheDocument();
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

    expect(frame).toHaveClass('rounded-frame', 'bg-bg-frame', 'inset-ring-border');
    expect(screen.getByText('Architektur')).toHaveClass('truncate');
    expect(screen.getByText('5 Blöcke')).toHaveClass('rounded-full', 'text-status', 'text-text-3');
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
    const { frame } = renderFrame({ diagramType: 'timeline' });

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
describe('FrameNode as a roadmap (spec 26a)', () => {
  const ROADMAP: Roadmap = {
    milestones: [
      {
        number: 1,
        title: 'Grundgerüst',
        goal: '',
        duration: { text: '3 Wochen', weeks: 3 },
        tasks: [{ id: null, text: 'Projekt aufsetzen', assignee: null }],
      },
      {
        number: 2,
        title: 'Mitglieder',
        goal: '',
        duration: { text: '4 Wochen', weeks: 4 },
        tasks: [],
      },
    ],
  };

  function renderRoadmap(roadmap: Roadmap | null, selected = false) {
    const actions = canvasActions();
    const view = render(
      <QueryClientProvider client={createQueryClient()}>
        <CanvasActionsProvider value={actions}>
          <RoadmapProvider value={{ projectId: null, roadmap }}>
            <FrameNode
              {...nodeBase}
              selected={selected}
              id="roadmap-1"
              type="frame"
              data={{
                ...common,
                label: 'Roadmap',
                size: FRAME_SIZE,
                blockCount: 0,
                diagramType: 'roadmap',
              }}
            />
          </RoadmapProvider>
        </CanvasActionsProvider>
      </QueryClientProvider>,
    );
    const frame = view.container.firstElementChild;
    if (!(frame instanceof HTMLElement)) throw new Error('The frame was not rendered.');
    return frame;
  }

  it('names its milestones and weeks instead of blocks and shows them', () => {
    const frame = renderRoadmap(ROADMAP);

    expect(screen.getByText('Roadmap · 2 Meilensteine · 7 Wochen')).toHaveClass('text-text-3');
    expect(frame.querySelector('.lucide-chart-gantt')).toBeInTheDocument();
    expect(screen.queryByText(/Blöcke/)).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Roadmap mit 2 Meilensteinen' })).toBeInTheDocument();
    expect(screen.getByText('Projekt aufsetzen')).toBeInTheDocument();
  });

  it('offers no change of its type, also when selected', () => {
    renderRoadmap(ROADMAP, true);

    expect(screen.queryByRole('button', { name: 'Diagrammtyp ändern' })).not.toBeInTheDocument();
  });

  it('names only its type while the roadmap is unknown', () => {
    renderRoadmap(null);

    expect(screen.getByText('Roadmap', { selector: 'span.text-status' })).toBeInTheDocument();
    expect(screen.getByText('Roadmap wird geladen …')).toBeInTheDocument();
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

  it('draws the curve in the edge color with an open head and a mono label pill', () => {
    const { arrow } = renderArrow();

    expect(arrow).toHaveAttribute('d', geometry.path);
    expect(arrow).toHaveAttribute('marker-end', 'url(#covibes-arrowhead-edge)');
    expect(arrow.style.stroke).toBe('var(--color-edge)');
    expect(arrow.style.strokeWidth).toBe('2');
    expect(arrow.style.strokeLinecap).toBe('round');
    expect(screen.getByText('REST')).toHaveClass('font-mono', 'text-badge', 'rounded-full');
  });

  it('shows an agent change in the agent color at 2.25 px, also on the label', () => {
    const { arrow } = renderArrow({ changedByAgent: 'moderator' });

    expect(arrow).toHaveAttribute('marker-end', 'url(#covibes-arrowhead-moderator)');
    expect(arrow.style.stroke).toBe('var(--color-agent-moderator)');
    expect(arrow.style.strokeWidth).toBe('2.25');
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
