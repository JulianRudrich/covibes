import type { DB } from '@covibes/db';
import {
  FILE_KINDS,
  formatFileSize,
  type AgentKnowledgeItem,
  type FileKind,
} from '@covibes/shared';
import type { Kysely } from 'kysely';

// The knowledge of a custom agent (spec 20b): files and links its creator gave it. A run lists it
// in the agent's context; the agent reads an entry with `read_file` or `read_link` when the
// question calls for it.

/** The columns of `agent_knowledge` an entry is built from. */
export const KNOWLEDGE_COLUMNS = [
  'id',
  'kind',
  'name',
  'url',
  'note',
  'file_kind',
  'media_type',
  'size_bytes',
] as const;

export type KnowledgeRow = {
  id: string;
  kind: string;
  name: string;
  url: string | null;
  note: string;
  file_kind: string | null;
  media_type: string | null;
  size_bytes: number | null;
};

export type KnowledgeEntry = AgentKnowledgeItem;

const isFileKind = (value: string | null): value is FileKind =>
  value !== null && (FILE_KINDS as readonly string[]).includes(value);

export function toKnowledgeEntry(row: KnowledgeRow): KnowledgeEntry {
  return {
    id: row.id,
    kind: row.kind === 'file' ? 'file' : 'link',
    name: row.name,
    url: row.url,
    note: row.note,
    fileKind: isFileKind(row.file_kind) ? row.file_kind : null,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
  };
}

/** The knowledge of a custom agent, oldest first; `admin` is the role the worker uses. */
export async function loadAgentKnowledge(
  admin: Kysely<DB>,
  agentId: string,
): Promise<KnowledgeEntry[]> {
  const rows = await admin
    .selectFrom('agent_knowledge')
    .select(KNOWLEDGE_COLUMNS)
    .where('agent_id', '=', agentId)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return rows.map(toKnowledgeEntry);
}

const KIND_NAMES: Record<FileKind, string> = { image: 'image', pdf: 'PDF', text: 'text file' };

/** One line per entry for the agent's context: a file with its id, a link with its note. */
export function describeKnowledge(entry: KnowledgeEntry): string {
  if (entry.kind === 'link') {
    return `- link ${entry.url ?? entry.name}${entry.note ? `: ${entry.note}` : ''}`;
  }
  const kind = entry.fileKind ? KIND_NAMES[entry.fileKind] : 'file';
  const size = entry.sizeBytes ? `, ${formatFileSize(entry.sizeBytes, 'en')}` : '';
  return `- file "${entry.name}" (${kind}${size}), id ${entry.id}`;
}
