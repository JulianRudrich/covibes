import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the content of uploaded files lies (`architecture.md`: "storage interface on the server: a
 * local folder, later S3-compatible"). Keys are made up by the server; the database knows which
 * file a key belongs to (invariant 8).
 */
export type FileStorage = {
  put: (key: string, content: Uint8Array) => Promise<void>;
  /** The content, or undefined if nothing is stored under the key. */
  get: (key: string) => Promise<Buffer | undefined>;
  /** Removes the content; a key without content is fine. */
  delete: (key: string) => Promise<void>;
};

/** Keys are lowercase UUIDs: nothing in them can leave the folder. */
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function checked(key: string): string {
  if (!KEY.test(key)) throw new Error('Invalid storage key');
  return key;
}

/**
 * The folder for files during local development and in tests: `.data/files` in the repository,
 * next to the local database. Found from this module, so server and worker agree whatever their
 * working directory is. The built server has no repository around it and needs `FILES_DIR`.
 */
export function defaultFilesDir(): string {
  return fileURLToPath(new URL('../../../../.data/files', import.meta.url));
}

/** File storage in a local folder, one file per key. */
export function localStorage(directory: string): FileStorage {
  const ready = mkdir(directory, { recursive: true });
  return {
    put: async (key, content) => {
      await ready;
      await writeFile(join(directory, checked(key)), content);
    },
    get: async (key) => {
      try {
        return await readFile(join(directory, checked(key)));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw error;
      }
    },
    delete: async (key) => {
      await rm(join(directory, checked(key)), { force: true });
    },
  };
}

/** File storage in memory, for tests. */
export function memoryStorage(): FileStorage & { keys: () => string[] } {
  const files = new Map<string, Buffer>();
  return {
    // Async like the real storage, so an invalid key rejects instead of throwing.
    put: async (key, content) => {
      await Promise.resolve();
      files.set(checked(key), Buffer.from(content));
    },
    get: async (key) => {
      await Promise.resolve();
      return files.get(checked(key));
    },
    delete: async (key) => {
      await Promise.resolve();
      files.delete(checked(key));
    },
    keys: () => [...files.keys()],
  };
}
