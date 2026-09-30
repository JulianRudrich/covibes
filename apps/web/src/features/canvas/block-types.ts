import { BLOCK_TYPES, type BlockType } from '@covibes/shared';
import {
  AppWindow,
  Database,
  Gauge,
  GitBranch,
  Network,
  Server,
  Square,
  type LucideIcon,
} from 'lucide-react';

/** Icons of the block types (spec 08), from the handoff's icon list. */
const ICONS: Readonly<Record<BlockType, LucideIcon>> = {
  app: AppWindow,
  server: Server,
  service: Network,
  database: Database,
  repository: GitBranch,
  metric: Gauge,
};

export function isBlockType(value: string | null): value is BlockType {
  return (BLOCK_TYPES as readonly (string | null)[]).includes(value);
}

/** The icon of a block; the generic block and types from a later version show a square. */
export function blockIcon(blockType: string | null): LucideIcon {
  return isBlockType(blockType) ? ICONS[blockType] : Square;
}

/** The choices of the type menu: the generic block first, then the types in their order. */
export const BLOCK_TYPE_CHOICES: readonly (BlockType | null)[] = [null, ...BLOCK_TYPES];
