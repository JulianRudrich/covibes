import '@xyflow/react/dist/base.css';

import {
  addBlock,
  addEdge,
  addFrame,
  addNote,
  edgeProblem,
  findFreeSpot,
  FRAME_SIZE,
  getNodesMap,
  GRID_SIZE,
  NOTE_SIZE,
  readEdges,
  readNodes,
  resizeFrame,
  updateEdgeLabel,
  updateNode,
  type Author,
  type AwarenessUser,
  type BlockType,
  type ProjectMember,
  type Size,
} from '@covibes/shared';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  ViewportPortal,
  type Connection,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { Frame, Plus, Square, StickyNote } from 'lucide-react';
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

import { Button } from '@web/components/ui/button';
import { PanelHeader } from '@web/components/ui/panel';
import { arrowGeometries, type Rect } from '@web/features/canvas/arrow-geometry';
import { BlockNode } from '@web/features/canvas/block-node';
import type { BoardConnection } from '@web/features/canvas/board-connection';
import { ArrowMarkers, CanvasArrow } from '@web/features/canvas/canvas-arrow';
import { CanvasActionsProvider, type CanvasActions } from '@web/features/canvas/canvas-actions';
import { FrameNode } from '@web/features/canvas/frame-node';
import { LiveCursor } from '@web/features/canvas/live-cursor';
import { NoteNode } from '@web/features/canvas/note-node';
import { useBoardDoc } from '@web/features/canvas/use-board-doc';
import { useLiveCursors } from '@web/features/canvas/use-live-cursors';
import { useNodeLocks } from '@web/features/canvas/use-node-locks';
import { useYjsFlow } from '@web/features/canvas/use-yjs-flow';
import { initialsOf } from '@web/lib/format';

const nodeTypes: NodeTypes = { block: BlockNode, sticky: NoteNode, frame: FrameNode };
const edgeTypes: EdgeTypes = { arrow: CanvasArrow };

const DELETE_KEYS = ['Delete', 'Backspace'];
const CONNECTION_LINE_STYLE = { stroke: 'var(--color-edge)', strokeWidth: 1.5 };

type CanvasPanelProps = {
  boardId: string;
  user: AwarenessUser;
  /** The project's members; the author lines show their names. */
  members: readonly ProjectMember[];
  /** Viewers see everything live but cannot change anything. */
  readOnly: boolean;
};

/** Header and live canvas of a board, as the two rows of the canvas panel (spec 05). */
export function CanvasPanel(props: CanvasPanelProps) {
  return (
    <ReactFlowProvider>
      <CanvasPanelContent {...props} />
    </ReactFlowProvider>
  );
}

type NewElement = 'block' | 'note' | 'frame';

function CanvasPanelContent({ boardId, user, members, readOnly }: CanvasPanelProps) {
  const { t } = useTranslation();
  const { screenToFlowPosition } = useReactFlow();
  const { connection, status, loaded, denied } = useBoardDoc(boardId);
  const surface = useRef<HTMLDivElement>(null);
  const author = useMemo<Author>(() => ({ kind: 'human', userId: user.id }), [user.id]);
  const ready = connection !== null && loaded && !denied;

  // Until the toolbar arrives (spec 10): a new element in the middle of the visible area.
  function addInView(kind: NewElement) {
    const rect = surface.current?.getBoundingClientRect();
    if (!connection || !rect) return;
    const { doc } = connection;
    const center = screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    const spot = (size?: Size) => findFreeSpot(readNodes(doc), center, size);
    const id = crypto.randomUUID();
    if (kind === 'block') {
      addBlock(doc, { id, position: spot(), label: t('canvas.newBlock') }, author);
    } else if (kind === 'note') {
      addNote(doc, { id, position: spot(NOTE_SIZE), text: t('canvas.newNote') }, author);
    } else {
      addFrame(doc, { id, position: spot(FRAME_SIZE), title: t('canvas.newFrame') }, author);
    }
  }

  return (
    <>
      <PanelHeader className="gap-1 px-3">
        <span className="flex h-[30px] shrink-0 items-center rounded-md bg-bg-subtle px-3 font-medium whitespace-nowrap">
          {t('workspace.mainCanvas')}
        </span>
        <button
          type="button"
          className="flex h-[30px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-ui whitespace-nowrap text-text-2b hover:bg-bg-subtle hover:text-text"
        >
          <Plus size={13} strokeWidth={2.2} aria-hidden="true" />
          {t('workspace.addBoard')}
        </button>
        {ready && !readOnly ? (
          <div className="ml-auto flex gap-1.5">
            <AddButton
              icon={<Square size={13} strokeWidth={2} aria-hidden="true" />}
              onClick={() => {
                addInView('block');
              }}
            >
              {t('canvas.addBlock')}
            </AddButton>
            <AddButton
              icon={<StickyNote size={13} strokeWidth={2} aria-hidden="true" />}
              onClick={() => {
                addInView('note');
              }}
            >
              {t('canvas.addNote')}
            </AddButton>
            <AddButton
              icon={<Frame size={13} strokeWidth={2} aria-hidden="true" />}
              onClick={() => {
                addInView('frame');
              }}
            >
              {t('canvas.addFrame')}
            </AddButton>
          </div>
        ) : null}
      </PanelHeader>

      <div ref={surface} className="relative min-h-0 bg-bg-canvas">
        {denied ? (
          <CanvasMessage>{t('canvas.denied')}</CanvasMessage>
        ) : connection && loaded ? (
          <Board
            connection={connection}
            user={user}
            members={members}
            author={author}
            readOnly={readOnly}
          />
        ) : (
          <CanvasMessage>{t('canvas.loading')}</CanvasMessage>
        )}
        {loaded && !denied && status !== 'connected' ? <ReconnectingPill /> : null}
      </div>
    </>
  );
}

function AddButton({
  icon,
  onClick,
  children,
}: {
  icon: ReactNode;
  onClick: () => void;
  children: string;
}) {
  return (
    <Button size="s" onClick={onClick}>
      {icon}
      {children}
    </Button>
  );
}

type BoardProps = {
  connection: BoardConnection;
  user: AwarenessUser;
  members: readonly ProjectMember[];
  author: Author;
  readOnly: boolean;
};

function Board({ connection, user, members, author, readOnly }: BoardProps) {
  const { t } = useTranslation();
  const { doc } = connection;
  const { locks, ownClientId, setEditing } = useNodeLocks(connection.provider);
  const [editingId, setEditingId] = useState<string | null>(null);
  const flowLocks = useMemo(() => ({ locks, ownClientId }), [locks, ownClientId]);
  const { nodes, edges, onNodesChange, onEdgesChange } = useYjsFlow(doc, {
    author,
    readOnly,
    locks: flowLocks,
    editingId,
  });
  const { cursors, onPointerMove, onPointerLeave } = useLiveCursors(connection.provider, user);

  // Arrows are anchored from where the blocks are right now, also while one is dragged here.
  const shownEdges = useMemo(() => {
    const rects = new Map<string, Rect>(
      nodes.map((node) => [
        node.id,
        { ...node.position, width: node.data.size.width, height: node.data.size.height },
      ]),
    );
    const geometries = arrowGeometries(edges, rects);
    return edges.map((edge) => {
      const geometry = geometries.get(edge.id);
      return edge.data && geometry ? { ...edge, data: { ...edge.data, geometry } } : edge;
    });
  }, [nodes, edges]);

  const lockedByOthers = useCallback(
    (id: string) => {
      const lock = locks.get(id);
      return lock !== undefined && lock.clientId !== ownClientId;
    },
    [locks, ownClientId],
  );

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

  const memberNames = useMemo(
    () => new Map(members.map((member) => [member.userId, member.name])),
    [members],
  );

  const actions = useMemo<CanvasActions>(
    () => ({
      readOnly,
      editingId,
      startEditing,
      finishEditing: (id, changes) => {
        const node = readNodes(doc).find((candidate) => candidate.id === id);
        const label = changes?.label.trim() ?? '';
        if (node && label) {
          const subtitle = changes?.subtitle?.trim();
          const update =
            node.type === 'block' ? { label, subtitle: subtitle ?? node.subtitle } : { label };
          const changed =
            label !== node.label || (node.type === 'block' && update.subtitle !== node.subtitle);
          if (changed) updateNode(doc, id, update, author);
        }
        stopEditing();
      },
      finishEdgeEditing: (id, label) => {
        if (label !== null) updateEdgeLabel(doc, id, label, author);
        stopEditing();
      },
      setType: (id: string, blockType: BlockType | null) => {
        if (!readOnly && !lockedByOthers(id)) updateNode(doc, id, { blockType }, author);
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
          const name = t(`agents.${elementAuthor.agentKey}`);
          return { name, initials: name.charAt(0).toUpperCase() };
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
      editingId,
      startEditing,
      stopEditing,
      lockedByOthers,
      doc,
      author,
      user.id,
      memberNames,
      t,
    ],
  );

  const isValidConnection = useCallback(
    (candidate: Connection | { source: string; target: string }) =>
      edgeProblem(doc, candidate.source, candidate.target) === null,
    [doc],
  );

  const onConnect = useCallback(
    (created: Connection) => {
      if (readOnly || edgeProblem(doc, created.source, created.target) !== null) return;
      addEdge(
        doc,
        { id: crypto.randomUUID(), source: created.source, target: created.target },
        author,
      );
    },
    [doc, author, readOnly],
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
        onNodeDoubleClick={(_, node) => {
          startEditing(node.id);
        }}
        onEdgeDoubleClick={(_, edge) => {
          startEditing(edge.id);
        }}
        onKeyDown={onKeyDown}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
        edgesFocusable={!readOnly}
        elevateNodesOnSelect={false}
        connectionLineStyle={CONNECTION_LINE_STYLE}
        deleteKeyCode={readOnly ? null : DELETE_KEYS}
        minZoom={0.3}
        maxZoom={2}
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
          {cursors.map((cursor) => (
            <LiveCursor key={cursor.clientId} cursor={cursor} />
          ))}
        </ViewportPortal>
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
