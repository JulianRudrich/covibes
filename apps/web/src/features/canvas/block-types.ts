import {
  BLOCK_TYPES,
  DIAGRAM_BLOCK_TYPES,
  DIAGRAM_TYPES,
  isDiagramType,
  type BlockType,
  type DiagramType,
} from '@covibes/shared';
import {
  AppWindow,
  Boxes,
  BrainCircuit,
  CircleDot,
  CirclePlay,
  CircleStop,
  Database,
  Frame,
  Gauge,
  GitBranch,
  Lightbulb,
  ListTree,
  Network,
  PanelTop,
  Server,
  Split,
  Square,
  SquareArrowRight,
  Table,
  TableProperties,
  Workflow,
  type LucideIcon,
} from 'lucide-react';

/** Icons of the block types (specs 08 and 12), from Lucide like the handoff's icons. */
const ICONS: Readonly<Record<BlockType, LucideIcon>> = {
  app: AppWindow,
  server: Server,
  service: Network,
  database: Database,
  repository: GitBranch,
  metric: Gauge,
  topic: CircleDot,
  idea: Lightbulb,
  entity: Table,
  start: CirclePlay,
  step: SquareArrowRight,
  decision: Split,
  end: CircleStop,
  page: PanelTop,
};

/** Icons of the diagram types in the frame header (spec 12). */
const DIAGRAM_ICONS: Readonly<Record<DiagramType, LucideIcon>> = {
  mindmap: BrainCircuit,
  architecture: Boxes,
  datamodel: TableProperties,
  flow: Workflow,
  sitemap: ListTree,
};

export function isBlockType(value: string | null): value is BlockType {
  return (BLOCK_TYPES as readonly (string | null)[]).includes(value);
}

/** The icon of a block; the generic block and types from a later version show a square. */
export function blockIcon(blockType: string | null): LucideIcon {
  return isBlockType(blockType) ? ICONS[blockType] : Square;
}

/** The icon of a frame; free frames and types from a later version show the frame icon. */
export function diagramIcon(diagramType: string | null): LucideIcon {
  return isDiagramType(diagramType) ? DIAGRAM_ICONS[diagramType] : Frame;
}

/** The choices of the diagram type menu: a free frame first, then the types in their order. */
export const DIAGRAM_TYPE_CHOICES: readonly (DiagramType | null)[] = [null, ...DIAGRAM_TYPES];

export type BlockTypeGroup = {
  /** The diagram the types belong to, shown as a heading; null for the generic block. */
  diagram: DiagramType | null;
  types: readonly (BlockType | null)[];
};

/**
 * The choices of the block type menu (spec 12): in a typed frame the generic block and the types
 * of that diagram; anywhere else the generic block and every type, grouped by diagram.
 */
export function blockTypeGroups(diagramType: string | null): BlockTypeGroup[] {
  if (isDiagramType(diagramType)) {
    return [{ diagram: null, types: [null, ...DIAGRAM_BLOCK_TYPES[diagramType]] }];
  }
  return [
    { diagram: null, types: [null] },
    ...DIAGRAM_TYPES.map((diagram) => ({ diagram, types: DIAGRAM_BLOCK_TYPES[diagram] })),
  ];
}
