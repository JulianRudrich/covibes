import {
  FILE_NAME_MAX_LENGTH,
  fileExtension,
  TEXT_FILE_TYPES,
  type FileKind,
} from '@covibes/shared';

// What an uploaded file is, decided by its content (spec 20a): the browser's claim about the type
// and the file name alone are never trusted.

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (text: string) => Array.from(text, (character) => character.charCodeAt(0));

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const GIF87 = ascii('GIF87a');
const GIF89 = ascii('GIF89a');
const RIFF = ascii('RIFF');
const WEBP = ascii('WEBP');
const PDF = ascii('%PDF-');

function isUtf8Text(bytes: Uint8Array): boolean {
  // Text has no NUL; binary formats nearly always do.
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/**
 * The kind and media type of a file, or undefined if it is nothing Covibes takes: an image the
 * models read (PNG, JPEG, WebP, GIF) or a PDF by its signature, or a known plain text format that
 * really is UTF-8 text.
 */
export function detectFile(
  name: string,
  bytes: Uint8Array,
): { kind: FileKind; mediaType: string } | undefined {
  if (startsWith(bytes, PNG)) return { kind: 'image', mediaType: 'image/png' };
  if (startsWith(bytes, JPEG)) return { kind: 'image', mediaType: 'image/jpeg' };
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) {
    return { kind: 'image', mediaType: 'image/gif' };
  }
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) {
    return { kind: 'image', mediaType: 'image/webp' };
  }
  if (startsWith(bytes, PDF)) return { kind: 'pdf', mediaType: 'application/pdf' };

  const mediaType = TEXT_FILE_TYPES[fileExtension(name)];
  return mediaType !== undefined && isUtf8Text(bytes) ? { kind: 'text', mediaType } : undefined;
}

/**
 * A file name that is safe to store and show: without folders and control characters, trimmed and
 * not longer than the database allows. A name that is empty afterwards becomes "file".
 */
export function cleanFileName(name: string): string {
  const base = name.split(/[/\\]/).at(-1) ?? '';
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (cleaned === '') return 'file';
  if (cleaned.length <= FILE_NAME_MAX_LENGTH) return cleaned;
  // Keep the extension, which says what the file is.
  const extension = fileExtension(cleaned);
  const suffix = extension ? `.${extension}` : '';
  return `${cleaned.slice(0, FILE_NAME_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`;
}
