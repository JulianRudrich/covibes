import '@xyflow/react/dist/base.css';

import {
  addBlock,
  addEdge,
  addFrame,
  addNote,
  authorOrigin,
  BLOCK_SIZE,
  boardToMermaid,
  computeLayout,
  edgeProblem,
  fitRoadmap,
  FRAME_MIN_SIZE,
  FRAME_SIZE,
  frameAt,
  getNodesMap,
  GRID_SIZE,
  isRoadmap,
  moveNodes,
  newBlockType,
  NOTE_SIZE,
  placeNodes,
  readEdges,
  readNodes,
  resizeFrame,
  ROADMAP_DIAGRAM,
  roadmapLayout,
  updateEdgeLabel,
  updateNode,
  type Author,
  type AwarenessUser,
  type BlockType,
  type PlanLanguage,
  type Position,
  type ProjectMember,
  type Proposal,
  type Size,
} from '@covibes/shared';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  useStoreApi,
  ViewportPortal,
  type Connection,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { PanelHeader } from '@web/components/ui/panel';
import { useAgents } from '@web/features/agents/agents';
import { BOARD_PANEL_ID, boardTabId } from '@web/features/canvas/board-ids';
import { BlockNode } from '@web/features/canvas/block-node';
import type { BoardConnection } from '@web/features/canvas/board-connection';
import {
  CanvasActionsProvider,
  type CanvasActions,
  type CanvasTool,
} from '@web/features/canvas/canvas-actions';
import { ArrowMarkers, CanvasArrow } from '@web/features/canvas/canvas-arrow';
import { CanvasToolbar } from '@web/features/canvas/canvas-toolbar';
import { EmptyBoardHint } from '@web/features/canvas/empty-board-hint';
import { loadElk } from '@web/features/canvas/elk';
import { sizeRoadmaps } from '@web/features/canvas/flow-mapping';
import { FrameNode } from '@web/features/canvas/frame-node';
import { LiveCursor } from '@web/features/canvas/live-cursor';
import { NoteNode } from '@web/features/canvas/note-node';
import { PlacementLayer, type Placement } from '@web/features/canvas/placement-layer';
import { edgesWithGeometry, nodeRects } from '@web/features/canvas/shown-edges';
import { ProposalLayer } from '@web/features/proposals/proposal-layer';
import { proposalOverlay } from '@web/features/proposals/proposal-overlay';
import type { DecideProposal } from '@web/features/proposals/queries';
import { useRoadmap } from '@web/features/roadmap/roadmap-context';
import { useBoardDoc } from '@web/features/canvas/use-board-doc';
import { useLiveCursors } from '@web/features/canvas/use-live-cursors';
import { useNodeLocks } from '@web/features/canvas/use-node-locks';
import { useUndo } from '@web/features/canvas/use-undo';
import { useYjsFlow } from '@web/features/canvas/use-yjs-flow';
import { ZOOM_MAX, ZOOM_MIN } from '@web/features/canvas/zoom';
import { boardImage, NO_EXPORT } from '@web/features/export/board-image';
import { downloadBlob, downloadText } from '@web/features/export/download';
import { ExportMenu, type ExportOption } from '@web/features/export/export-menu';
import { initialsOf } from '@web/lib/format';

const nodeTypes: NodeTypes = { block: BlockNode, sticky: NoteNode, frame: FrameNode };
const edgeTypes: EdgeTypes = { arrow: CanvasArrow };

const DELETE_KEYS = ['Delete', 'Backspace'];
const CONNECTION_LINE_STYLE = { stroke: 'var(--color-edge)', strokeWidth: 1.5 };

type CanvasPanelProps = {
  boardId: string;
  /** The board tabs of the header (spec 11). */
  tabs: ReactNode;
  /** A short note over the canvas, e.g. that the open board was deleted. */
  notice: string | null;
  user: AwarenessUser;
  /** The project's members; the author lines show their names. */
  members: readonly ProjectMember[];
  /** Viewers see everything live but cannot change anything. */
  readOnly: boolean;
  /** The open proposals of the project; the canvas shows those of its board (spec 13). */
  proposals: readonly Proposal[];
  onDecide: DecideProposal;
  /** Whether the user adopts variants; false for editors while the owner decides. */
  canAdoptVariants?: boolean;
  /** An element to bring into view once it is on the board, e.g. the roadmap (spec 26a). */
  focusId?: string;
  onFocused?: () => void;
  /** What the exports of the board are called (spec 27a); without it the board offers none. */
  exports?: BoardExports;
};

export type BoardExports = {
  /** The title of the board, the heading of its Mermaid file. */
  title: string;
  /** The name of the files, without their ending. */
  fileName: string;
  /** The project's language, in which an export writes what it adds. */
  language: PlanLanguage;
  onFailed: () => void;
};

/**
 * Header and live canvas of the open board, as the two rows of the canvas panel (specs 05 and 11).
 * Another board gets a canvas of its own, so each board keeps its connection only while it is
 * shown.
 */
export function CanvasPanel({ boardId, tabs, notice, ...canvas }: CanvasPanelProps) {
  return (
    <>
      <PanelHeader className="gap-1 px-3">{tabs}</PanelHeader>

      <div
        id={BOARD_PANEL_ID}
        role="tabpanel"
        aria-labelledby={boardTabId(boardId)}
        className="relative min-h-0 bg-bg-canvas"
      >
        <ReactFlowProvider key={boardId}>
          <BoardCanvas boardId={boardId} {...canvas} />
        </ReactFlowProvider>
        {notice ? <NoticePill>{notice}</NoticePill> : null}
      </div>
    </>
  );
}

function BoardCanvas({
  boardId,
  user,
  members,
  readOnly,
  proposals,
  onDecide,
  canAdoptVariants,
  focusId,
  onFocused,
  exports,
}: Omit<CanvasPanelProps, 'tabs' | 'notice'>) {
  const { t } = useTranslation();
  const { connection, status, loaded, denied } = useBoardDoc(boardId);
  const author = useMemo<Author>(() => ({ kind: 'human', userId: user.id }), [user.id]);

  return (
    <>
      {denied ? (
        <CanvasMessage>{t('canvas.denied')}</CanvasMessage>
      ) : connection && loaded ? (
        <Board
          boardId={boardId}
          connection={connection}
          user={user}
          members={members}
          author={author}
          readOnly={readOnly}
          proposals={proposals}
          onDecide={onDecide}
          canAdoptVariants={canAdoptVariants}
          focusId={focusId}
          onFocused={onFocused}
          exports={exports}
        />
      ) : (
        <CanvasMessage>{t('canvas.loading')}</CanvasMessage>
      )}
      {loaded && !denied && status !== 'connected' ? <ReconnectingPill /> : null}
    </>
  );
}

type BoardProps = {
  boardId: string;
  connection: BoardConnection;
  user: AwarenessUser;
  members: readonly ProjectMember[];
  author: Author;
  readOnly: boolean;
  proposals: readonly Proposal[];
  onDecide: DecideProposal;
  /** Whether the user adopts variants; false for editors while the owner decides. */
  canAdoptVariants?: boolean;
  focusId?: string;
  onFocused?: () => void;
  exports?: BoardExports;
};

/** Room around an element brought into view, on each side. */
const FOCUS_MARGIN = 48;

function snap(value: number) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

/** The top-left corner that centers an element of `size` on `point`, on the grid. */
function centeredOn(point: Position, size: Size): Position {
  return { x: snap(point.x - size.width / 2), y: snap(point.y - size.height / 2) };
}

function Board({
  boardId,
  connection,
  user,
  members,
  author,
  readOnly,
  proposals,
  onDecide,
  canAdoptVariants,
  focusId,
  onFocused,
  exports,
}: BoardProps) {
  const { t } = useTranslation();
  const agents = useAgents();
  const { doc } = connection;
  const { locks, ownClientId, setEditing } = useNodeLocks(connection.provider);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tool, setTool] = useState<CanvasTool | null>(null);
  const [layoutBusy, setLayoutBusy] = useState(false);
  const flowLocks = useMemo(() => ({ locks, ownClientId }), [locks, ownClientId]);
  const {
    nodes: flowNodes,
    edges,
    onNodesChange,
    onEdgesChange,
  } = useYjsFlow(doc, {
    author,
    readOnly,
    locks: flowLocks,
    editingId,
  });

  // A roadmap (spec 26a) has the size of its content, which comes from the plan. Owners and
  // editors keep the stored size in line, so layout and agents see it too. A client writes when
  // a roadmap appears or the roadmap it knows changes, never because the stored size changed:
  // two clients that know different states of the plan for a moment would write in turns.
  const roadmapFrames = flowNodes
    .filter((node) => node.type === 'frame' && node.data.diagramType === ROADMAP_DIAGRAM)
    .map((node) => node.id)
    .join(' ');
  const roadmap = useRoadmap(roadmapFrames !== '');
  const roadmapSize = useMemo(() => (roadmap ? roadmapLayout(roadmap).size : null), [roadmap]);
  const nodes = useMemo(() => sizeRoadmaps(flowNodes, roadmapSize), [flowNodes, roadmapSize]);
  useEffect(() => {
    if (readOnly || !roadmapSize || roadmapFrames === '') return;
    for (const node of readNodes(doc)) {
      if (isRoadmap(node)) fitRoadmap(doc, node.id, roadmapSize);
    }
  }, [doc, readOnly, roadmapSize, roadmapFrames]);

  // An element asked for in the address comes into view once it is on the board.
  const { setCenter } = useReactFlow();
  const paneWidth = useStore((state) => state.width);
  const paneHeight = useStore((state) => state.height);
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!focusId) {
      // The address forgot it; the same element can be asked for again.
      focused.current = null;
      return;
    }
    if (focused.current === focusId || paneWidth === 0 || paneHeight === 0) return;
    const target = nodes.find((node) => node.id === focusId);
    if (!target) return;
    focused.current = focusId;
    const width = target.width ?? target.measured?.width ?? 0;
    const height = target.height ?? target.measured?.height ?? 0;
    const zoom = Math.max(
      ZOOM_MIN,
      Math.min(1, paneWidth / (width + 2 * FOCUS_MARGIN), paneHeight / (height + 2 * FOCUS_MARGIN)),
    );
    // At once, without a movement: the board just opened, and a movement would never end in a tab
    // that is not drawn right now, while the address already forgot what to show.
    void setCenter(target.position.x + width / 2, target.position.y + height / 2, { zoom });
    onFocused?.();
  }, [focusId, nodes, paneWidth, paneHeight, setCenter, onFocused]);
  const { cursors, onPointerMove, onPointerLeave } = useLiveCursors(connection.provider, user);
  const undo = useUndo(doc, author, !readOnly);

  // Where every element is right now, also while one is dragged here.
  const rects = useMemo(() => nodeRects(nodes), [nodes]);
  // What the open proposals of this board show on top of it (spec 13).
  const overlay = useMemo(
    () => proposalOverlay(proposals, boardId, new Set(rects.keys())),
    [proposals, boardId, rects],
  );
  const proposalsById = useMemo(
    () => new Map(proposals.map((proposal) => [proposal.id, proposal])),
    [proposals],
  );

  // Arrows are anchored from where the blocks are right now, also while one is dragged here.
  const shownEdges = useMemo(() => edgesWithGeometry(nodes, edges, rects), [nodes, edges, rects]);

  const lockedByOthers = useCallback(
    (id: string) => {
      const lock = locks.get(id);
      return lock !== undefined && lock.clientId !== ownClientId;
    },
    [locks, ownClientId],
  );

  const beginChange = useCallback(() => {
    undo?.stopCapturing();
  }, [undo]);

  const stopEditing = useCallback(() => {
    setEditingId(null);
    setEditing(null);
  }, [setEditing]);

  const startEditing = useCallback(
    (id: string) => {
      if (readOnly || lockedByOthers(id)) return;
      setEditingId(id);
      // Arrows have no lock; only the texts of nodes do (spec 08).
      setEditing(getNodesMap(doc).has(id) ? id : null);
    },
    [readOnly, lockedByOthers, setEditing, doc],
  );

  // Someone else started editing the node first, or the element was removed: editing ends unsaved.
  useEffect(() => {
    if (editingId === null) return;
    const exists =
      getNodesMap(doc).has(editingId) || readEdges(doc).some((edge) => edge.id === editingId);
    if (lockedByOthers(editingId) || !exists) stopEditing();
  }, [editingId, lockedByOthers, doc, nodes, edges, stopEditing]);

  // Escape ends every mode of the toolbar.
  useEffect(() => {
    if (tool === null) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setTool(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [tool]);

  const memberNames = useMemo(
    () => new Map(members.map((member) => [member.userId, member.name])),
    [members],
  );

  const actions = useMemo<CanvasActions>(
    () => ({
      readOnly,
      tool,
      beginChange,
      editingId,
      startEditing,
      finishEditing: (id, changes) => {
        const node = readNodes(doc).find((candidate) => candidate.id === id);
        const label = changes?.label.trim() ?? '';
        if (node && label) {
          const subtitle = node.type === 'block' ? changes?.subtitle?.trim() : undefined;
          // Fields only count when the editor had them, i.e. for entities (spec 12).
          const fields =
            changes?.fields && JSON.stringify(changes.fields) !== JSON.stringify(node.fields)
              ? changes.fields
              : undefined;
          const changed =
            label !== node.label ||
            (subtitle !== undefined && subtitle !== node.subtitle) ||
            fields !== undefined;
          if (changed) {
            beginChange();
            updateNode(
              doc,
              id,
              {
                label,
                ...(subtitle !== undefined ? { subtitle } : {}),
                ...(fields ? { fields } : {}),
              },
              author,
            );
          }
        }
        stopEditing();
      },
      finishEdgeEditing: (id, label) => {
        if (label !== null) {
          beginChange();
          updateEdgeLabel(doc, id, label, author);
        }
        stopEditing();
      },
      setType: (id: string, blockType: BlockType | null) => {
        if (readOnly || lockedByOthers(id)) return;
        beginChange();
        updateNode(doc, id, { blockType }, author);
      },
      setDiagramType: (id, diagramType) => {
        if (readOnly || lockedByOthers(id)) return;
        beginChange();
        updateNode(doc, id, { diagramType }, author);
      },
      resizeFrame: (id, bounds) => {
        if (readOnly || lockedByOthers(id)) return;
        resizeFrame(
          doc,
          id,
          {
            position: { x: bounds.x, y: bounds.y },
            size: { width: bounds.width, height: bounds.height },
          },
          author,
        );
      },
      authorOf: (elementAuthor) => {
        if (elementAuthor.kind === 'agent') {
          const { name, initials } = agents(elementAuthor.agentKey);
          return { name, initials };
        }
        if (elementAuthor.userId === user.id) {
          return { name: t('common.you'), initials: t('common.you') };
        }
        const name = memberNames.get(elementAuthor.userId);
        return name
          ? { name, initials: initialsOf(name) }
          : { name: t('canvas.formerMember'), initials: '?' };
      },
    }),
    [
      readOnly,
      tool,
      beginChange,
      editingId,
      startEditing,
      stopEditing,
      lockedByOthers,
      doc,
      author,
      user.id,
      memberNames,
      agents,
      t,
    ],
  );

  /** Places the element of the active tool, ends the mode and starts editing its text. */
  function place(placement: Placement) {
    if (readOnly || !tool || tool === 'connect') return;
    const id = crypto.randomUUID();
    beginChange();
    doc.transact(() => {
      if (tool === 'frame') {
        const bounds =
          placement.kind === 'area'
            ? {
                position: { x: snap(placement.from.x), y: snap(placement.from.y) },
                size: {
                  width: Math.max(FRAME_MIN_SIZE.width, snap(placement.to.x - placement.from.x)),
                  height: Math.max(FRAME_MIN_SIZE.height, snap(placement.to.y - placement.from.y)),
                },
              }
            : { position: centeredOn(placement.at, FRAME_SIZE), size: FRAME_SIZE };
        addFrame(doc, { id, title: t('canvas.newFrame'), ...bounds }, author);
        // A frame drawn around free elements takes them in; members of other frames stay there.
        const free = readNodes(doc).filter((node) => node.type !== 'frame' && !node.frameId);
        placeNodes(
          doc,
          free.map((node) => node.id),
          author,
        );
        return;
      }
      const at = placement.kind === 'point' ? placement.at : placement.from;
      if (tool === 'block') {
        // In a diagram, a new block gets the diagram's type (spec 12).
        const current = readNodes(doc);
        const frame = frameAt(current, at);
        const blockType = frame
          ? newBlockType(
              frame.diagramType,
              current.filter((node) => node.frameId === frame.id),
            )
          : null;
        addBlock(
          doc,
          { id, position: centeredOn(at, BLOCK_SIZE), label: t('canvas.newBlock'), blockType },
          author,
        );
      } else {
        addNote(
          doc,
          { id, position: centeredOn(at, NOTE_SIZE), text: t('canvas.newNote') },
          author,
        );
      }
      // Placed inside a frame, it belongs to it, like a block dropped there.
      placeNodes(doc, [id], author);
    }, authorOrigin(author));
    setTool(null);
    startEditing(id);
  }

  async function autoLayout() {
    if (readOnly || layoutBusy) return;
    setLayoutBusy(true);
    try {
      const elk = await loadElk();
      const selectedFrames = nodes.filter((node) => node.selected && node.type === 'frame');
      const frameId = selectedFrames.length === 1 ? (selectedFrames[0]?.id ?? null) : null;
      const layout = await computeLayout(elk, readNodes(doc), readEdges(doc), frameId);
      beginChange();
      doc.transact(() => {
        // Elements that someone else edits keep their place.
        moveNodes(
          doc,
          [...layout.positions].filter(([id]) => !lockedByOthers(id)),
          author,
        );
        for (const [id, size] of layout.frameSizes) {
          if (lockedByOthers(id)) continue;
          const position = layout.positions.get(id);
          resizeFrame(doc, id, position ? { size, position } : { size }, author);
        }
      }, authorOrigin(author));
      beginChange();
    } finally {
      setLayoutBusy(false);
    }
  }

  const isValidConnection = useCallback(
    (candidate: Connection | { source: string; target: string }) =>
      edgeProblem(doc, candidate.source, candidate.target) === null,
    [doc],
  );

  const onConnect = useCallback(
    (created: Connection) => {
      if (readOnly || edgeProblem(doc, created.source, created.target) !== null) return;
      beginChange();
      addEdge(
        doc,
        { id: crypto.randomUUID(), source: created.source, target: created.target },
        author,
      );
    },
    [doc, author, readOnly, beginChange],
  );

  // Enter on the one selected element starts editing its text, unless the key belongs to a control.
  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || editingId !== null) return;
    if (
      event.target instanceof Element &&
      event.target.closest('button, input, textarea, [role="menu"]')
    ) {
      return;
    }
    const selectedNodes = nodes.filter((node) => node.selected);
    const selectedEdges = edges.filter((edge) => edge.selected);
    const [only] = selectedNodes.length > 0 ? selectedNodes : selectedEdges;
    if (selectedNodes.length + selectedEdges.length !== 1 || !only) return;
    event.preventDefault();
    startEditing(only.id);
  }

  const placing = tool === 'block' || tool === 'note' || tool === 'frame';

  // The board as files (spec 27a): an image of everything on it, or its diagrams as Mermaid.
  const store = useStoreApi();
  const exportOptions = useMemo<ExportOption[] | null>(() => {
    if (!exports) return null;
    const image = (format: 'png' | 'svg') => async () => {
      // The image shows the board, not what is selected on it right now.
      onNodesChange(
        nodes
          .filter((node) => node.selected)
          .map((node) => ({ type: 'select' as const, id: node.id, selected: false })),
      );
      onEdgesChange(
        edges
          .filter((edge) => edge.selected)
          .map((edge) => ({ type: 'select' as const, id: edge.id, selected: false })),
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      const viewport = store
        .getState()
        .domNode?.querySelector<HTMLElement>('.react-flow__viewport');
      if (!viewport) throw new Error('The board is not drawn');
      downloadBlob(await boardImage(viewport, format), `${exports.fileName}.${format}`);
    };
    return [
      { key: 'png', label: t('export.png'), run: image('png') },
      { key: 'svg', label: t('export.svg'), run: image('svg') },
      {
        key: 'mermaid',
        label: t('export.mermaid'),
        run: () => {
          downloadText(
            boardToMermaid({
              title: exports.title,
              nodes: readNodes(doc),
              edges: readEdges(doc),
              roadmap,
              language: exports.language,
            }),
            `${exports.fileName}.md`,
          );
        },
      },
    ];
  }, [exports, nodes, edges, onNodesChange, onEdgesChange, store, doc, roadmap, t]);

  return (
    <CanvasActionsProvider value={actions}>
      <ArrowMarkers />
      <ReactFlow
        nodes={nodes}
        edges={shownEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onNodeDragStart={beginChange}
        onNodeDoubleClick={(_, node) => {
          startEditing(node.id);
        }}
        onEdgeDoubleClick={(_, edge) => {
          startEditing(edge.id);
        }}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        nodesDraggable={!readOnly && tool !== 'connect'}
        nodesConnectable={!readOnly}
        edgesFocusable={!readOnly}
        elevateNodesOnSelect={false}
        connectionLineStyle={CONNECTION_LINE_STYLE}
        deleteKeyCode={readOnly ? null : DELETE_KEYS}
        minZoom={ZOOM_MIN}
        maxZoom={ZOOM_MAX}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={GRID_SIZE}
          size={2}
          color="var(--color-canvas-dot)"
          bgColor="var(--color-bg-canvas)"
        />
        <ViewportPortal>
          {/* Proposals and the cursors of others are no part of the board: an image leaves them out. */}
          <div className="contents" {...{ [NO_EXPORT]: '' }}>
            <ProposalLayer
              overlay={overlay}
              rects={rects}
              proposals={proposalsById}
              canDecide={!readOnly}
              canAdoptVariants={canAdoptVariants}
              onDecide={onDecide}
            />
            {cursors.map((cursor) => (
              <LiveCursor key={cursor.clientId} cursor={cursor} />
            ))}
          </div>
        </ViewportPortal>
        {/* An empty board says how to start (spec 33), unless something is on its way. */}
        {nodes.length === 0 && overlay.elements.length === 0 && !placing ? (
          <EmptyBoardHint readOnly={readOnly} />
        ) : null}
        {placing ? <PlacementLayer drawsArea={tool === 'frame'} onPlace={place} /> : null}
        <CanvasToolbar
          tool={tool}
          onToolChange={setTool}
          onAutoLayout={() => void autoLayout()}
          layoutBusy={layoutBusy}
          readOnly={readOnly}
          end={
            exportOptions && exports ? (
              <ExportMenu
                options={exportOptions}
                onFailed={exports.onFailed}
                className="grid h-[34px] w-[30px] rounded-md text-text-body hover:bg-bg-subtle"
              />
            ) : null
          }
        />
      </ReactFlow>
    </CanvasActionsProvider>
  );
}

function CanvasMessage({ children }: { children: string }) {
  return (
    <div className="absolute inset-0 grid place-items-center p-6 text-center text-ui text-text-3">
      {children}
    </div>
  );
}

function NoticePill({ children }: { children: string }) {
  return (
    <div
      role="status"
      className="absolute top-3 left-1/2 z-10 flex h-[26px] -translate-x-1/2 items-center rounded-[13px] bg-bg-panel px-3 text-status whitespace-nowrap text-text-body shadow-float"
    >
      {children}
    </div>
  );
}

function ReconnectingPill() {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="absolute top-3 left-1/2 z-10 flex h-[26px] -translate-x-1/2 items-center gap-2 rounded-[13px] bg-bg-muted px-3 text-status text-text-2 shadow-float"
    >
      <span className="size-1.5 animate-pulse rounded-full bg-text-3" aria-hidden="true" />
      {t('canvas.reconnecting')}
    </div>
  );
}
