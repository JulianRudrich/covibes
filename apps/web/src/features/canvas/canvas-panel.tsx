import '@xyflow/react/dist/base.css';

import { addBlock, findFreeSpot, GRID_SIZE, readNodes, type Author } from '@covibes/shared';
import {
  Background,
  BackgroundVariant,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  ViewportPortal,
  type NodeTypes,
} from '@xyflow/react';
import { Plus, Square } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { PanelHeader } from '@web/components/ui/panel';
import type { AwarenessUser } from '@web/features/canvas/awareness';
import { BlockNode } from '@web/features/canvas/block-node';
import type { BoardConnection } from '@web/features/canvas/board-connection';
import { LiveCursor } from '@web/features/canvas/live-cursor';
import { useBoardDoc } from '@web/features/canvas/use-board-doc';
import { useLiveCursors } from '@web/features/canvas/use-live-cursors';
import { useYjsFlow } from '@web/features/canvas/use-yjs-flow';

const nodeTypes: NodeTypes = { block: BlockNode };

type CanvasPanelProps = {
  boardId: string;
  user: AwarenessUser;
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

function CanvasPanelContent({ boardId, user, readOnly }: CanvasPanelProps) {
  const { t } = useTranslation();
  const { screenToFlowPosition } = useReactFlow();
  const { connection, status, loaded, denied } = useBoardDoc(boardId);
  const surface = useRef<HTMLDivElement>(null);
  const author = useMemo<Author>(() => ({ kind: 'human', userId: user.id }), [user.id]);
  const ready = connection !== null && loaded && !denied;

  // Until the toolbar arrives (spec 10): a new block in the middle of the visible area.
  function addBlockInView() {
    const rect = surface.current?.getBoundingClientRect();
    if (!connection || !rect) return;
    const center = screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    addBlock(
      connection.doc,
      {
        id: crypto.randomUUID(),
        position: findFreeSpot(readNodes(connection.doc), center),
        label: t('canvas.newBlock'),
      },
      author,
    );
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
          <Button size="s" className="ml-auto" onClick={addBlockInView}>
            <Square size={13} strokeWidth={2} aria-hidden="true" />
            {t('canvas.addBlock')}
          </Button>
        ) : null}
      </PanelHeader>

      <div ref={surface} className="relative min-h-0 bg-bg-canvas">
        {denied ? (
          <CanvasMessage>{t('canvas.denied')}</CanvasMessage>
        ) : connection && loaded ? (
          <Board connection={connection} user={user} author={author} readOnly={readOnly} />
        ) : (
          <CanvasMessage>{t('canvas.loading')}</CanvasMessage>
        )}
        {loaded && !denied && status !== 'connected' ? <ReconnectingPill /> : null}
      </div>
    </>
  );
}

type BoardProps = {
  connection: BoardConnection;
  user: AwarenessUser;
  author: Author;
  readOnly: boolean;
};

function Board({ connection, user, author, readOnly }: BoardProps) {
  const { nodes, edges, onNodesChange } = useYjsFlow(connection.doc, author, readOnly);
  const { cursors, onPointerMove, onPointerLeave } = useLiveCursors(connection.provider, user);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      nodesDraggable={!readOnly}
      nodesConnectable={false}
      edgesFocusable={false}
      deleteKeyCode={null}
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
