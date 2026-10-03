import '@xyflow/react/dist/base.css';

import { GRID_SIZE, roadmapLayout, type SharedBoard } from '@covibes/shared';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  ReactFlow,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAgents } from '@web/features/agents/agents';
import { BlockNode } from '@web/features/canvas/block-node';
import { CanvasActionsProvider, type CanvasActions } from '@web/features/canvas/canvas-actions';
import { ArrowMarkers, CanvasArrow } from '@web/features/canvas/canvas-arrow';
import { CanvasToolbar } from '@web/features/canvas/canvas-toolbar';
import {
  sizeRoadmaps,
  toFlowEdges,
  toFlowNodes,
  type CanvasFlowNode,
  type FlowLocks,
} from '@web/features/canvas/flow-mapping';
import { FrameNode } from '@web/features/canvas/frame-node';
import { NoteNode } from '@web/features/canvas/note-node';
import { edgesWithGeometry, nodeRects } from '@web/features/canvas/shown-edges';
import { ZOOM_MAX, ZOOM_MIN } from '@web/features/canvas/zoom';
import { RoadmapProvider, type RoadmapSource } from '@web/features/roadmap/roadmap-context';

const nodeTypes: NodeTypes = { block: BlockNode, sticky: NoteNode, frame: FrameNode };
const edgeTypes: EdgeTypes = { arrow: CanvasArrow };

/** Nobody edits anything in the read-only view. */
const NO_LOCKS: FlowLocks = { locks: new Map(), ownClientId: 0 };

const nothing = () => undefined;

/**
 * A board in the read-only view (spec 21b): the same blocks, notes, frames and arrows as on the
 * live canvas, from a snapshot instead of a connection. Visitors move the view and zoom; nothing
 * can be selected, moved or changed. Agents keep their names, people are "Teammitglied". A
 * roadmap shows the one of the snapshot (spec 26a).
 */
export function SharedBoardCanvas({ nodes, edges, roadmap }: SharedBoard) {
  const { t } = useTranslation();
  const agents = useAgents();
  const [measuredNodes, setFlowNodes] = useState<CanvasFlowNode[]>(() =>
    toFlowNodes(nodes, [], NO_LOCKS),
  );
  const flowNodes = useMemo(
    () => sizeRoadmaps(measuredNodes, roadmap ? roadmapLayout(roadmap).size : null),
    [measuredNodes, roadmap],
  );
  const roadmapSource = useMemo<RoadmapSource>(() => ({ projectId: null, roadmap }), [roadmap]);
  // A newer snapshot keeps what the canvas measured of the elements that stayed.
  useEffect(() => {
    setFlowNodes((previous) => toFlowNodes(nodes, previous, NO_LOCKS));
  }, [nodes]);
  // The canvas reports the measured sizes; nothing else changes here.
  const onNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    const measured = changes.filter((change) => change.type === 'dimensions');
    if (measured.length > 0) setFlowNodes((previous) => applyNodeChanges(measured, previous));
  }, []);

  const flowEdges = useMemo(
    () => edgesWithGeometry(flowNodes, toFlowEdges(edges, nodes), nodeRects(flowNodes)),
    [flowNodes, edges, nodes],
  );

  const actions = useMemo<CanvasActions>(
    () => ({
      readOnly: true,
      tool: null,
      beginChange: nothing,
      editingId: null,
      startEditing: nothing,
      finishEditing: nothing,
      finishEdgeEditing: nothing,
      setType: nothing,
      setDiagramType: nothing,
      resizeFrame: nothing,
      authorOf: (author) => {
        if (author.kind === 'agent') {
          const { name, initials } = agents(author.agentKey);
          return { name, initials };
        }
        return { name: t('shareView.teamMember'), initials: '·' };
      },
    }),
    [agents, t],
  );

  return (
    <CanvasActionsProvider value={actions}>
      <RoadmapProvider value={roadmapSource}>
        <ArrowMarkers />
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          nodesDraggable={false}
          nodesConnectable={false}
          nodesFocusable={false}
          edgesFocusable={false}
          elementsSelectable={false}
          deleteKeyCode={null}
          minZoom={ZOOM_MIN}
          maxZoom={ZOOM_MAX}
          fitView
          fitViewOptions={{ maxZoom: 1, padding: 0.12 }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={GRID_SIZE}
            size={2}
            color="var(--color-canvas-dot)"
            bgColor="var(--color-bg-canvas)"
          />
          <CanvasToolbar
            tool={null}
            onToolChange={nothing}
            onAutoLayout={nothing}
            layoutBusy={false}
            readOnly
          />
        </ReactFlow>
      </RoadmapProvider>
    </CanvasActionsProvider>
  );
}
