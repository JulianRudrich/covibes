import { z } from 'zod';

// Files that people attach to chat messages (spec 20a). The server decides what a file is by its
// content; agents read files with a tool, and what a file says is data, never an instruction.

/** How agents read a file: an image to look at, a PDF page by page, or plain text. */
export const FILE_KINDS = ['image', 'pdf', 'text'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** Same limit as the check constraint on `files.size_bytes` (packages/db/migrations). */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Images are sent to the model as they are, which takes at most this much. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const FILE_NAME_MAX_LENGTH = 200;

/** The image formats the models read. */
export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

/**
 * Plain text formats by extension, with the media type the file is stored under. Anything listed
 * here must also be valid UTF-8 to count as text.
 */
export const TEXT_FILE_TYPES: Readonly<Record<string, string>> = {
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  xml: 'application/xml',
  html: 'text/html',
  css: 'text/css',
  sql: 'application/sql',
  log: 'text/plain',
  js: 'text/javascript',
  jsx: 'text/javascript',
  ts: 'text/typescript',
  tsx: 'text/typescript',
  py: 'text/x-python',
  java: 'text/x-java',
  kt: 'text/x-kotlin',
  go: 'text/x-go',
  rs: 'text/x-rust',
  rb: 'text/x-ruby',
  php: 'text/x-php',
  cs: 'text/x-csharp',
  sh: 'text/x-shellscript',
  toml: 'application/toml',
  ini: 'text/plain',
  env: 'text/plain',
};

/** The `accept` attribute of the file picker: what the server takes. */
export const FILE_ACCEPT = [
  ...IMAGE_MEDIA_TYPES,
  'application/pdf',
  ...Object.keys(TEXT_FILE_TYPES).map((extension) => `.${extension}`),
].join(',');

/** The lowercase extension of a file name, without the dot; empty if it has none. */
export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 || dot === name.length - 1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** A file attached to a chat message, as the API and the live channel deliver it. */
export const messageAttachmentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(FILE_KINDS),
  mediaType: z.string(),
  sizeBytes: z.number().int().positive(),
});
export type MessageAttachment = z.infer<typeof messageAttachmentSchema>;

/** The ids of uploaded files to attach to a message: each once, at most five. */
export const attachmentIdsSchema = z
  .array(z.uuid())
  .max(MAX_ATTACHMENTS_PER_MESSAGE)
  .refine((ids) => new Set(ids).size === ids.length, 'Every file once');

/** A size for people, e.g. "340 kB" or "2,4 MB" (decimal comma by the locale). */
export function formatFileSize(bytes: number, locale: string): string {
  const format = (value: number, digits: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  if (bytes < 1000) return `${format(bytes, 0)} B`;
  if (bytes < 1000 * 1000) return `${format(bytes / 1000, 0)} kB`;
  return `${format(bytes / (1000 * 1000), 1)} MB`;
}
