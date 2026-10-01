import {
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_FILE_BYTES,
  type MessageAttachment,
} from '@covibes/shared';
import { useCallback, useMemo, useRef, useState } from 'react';

import { api, ApiError } from '@web/lib/api';

/** The path of a file below `/api`. */
function filePath(projectId: string, fileId: string): string {
  return `/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`;
}

/** The address a member opens or downloads a file from. */
export function fileUrl(projectId: string, fileId: string): string {
  return `/api${filePath(projectId, fileId)}`;
}

/** Why a file could not be attached. */
export type UploadProblem = 'too_many' | 'too_large' | 'unsupported' | 'failed';

/** A file chosen for the next message: on its way or uploaded. */
export type PendingUpload = {
  /** Made up in the browser; the server's id comes with `attachment`. */
  localId: string;
  name: string;
  sizeBytes: number;
  status: 'uploading' | 'done';
  attachment?: MessageAttachment;
};

export type Uploads = {
  items: readonly PendingUpload[];
  /** The uploaded files, in the order they were chosen. */
  attachments: readonly MessageAttachment[];
  /** True while a file is still on its way; the message waits for it. */
  uploading: boolean;
  add: (files: readonly File[]) => void;
  /** Takes a file off again and removes its upload from the server. */
  remove: (localId: string) => void;
  /** Forgets the files after their message was sent; they stay on the server. */
  clear: () => void;
};

function problemOf(error: unknown): UploadProblem {
  if (!(error instanceof ApiError)) return 'failed';
  if (error.code === 'too_large') return 'too_large';
  if (error.code === 'unsupported_file') return 'unsupported';
  return 'failed';
}

/**
 * The files of the message being written (spec 20a): each uploads as soon as it is chosen and can
 * be taken off again; sending the message attaches the uploaded ones. A file that cannot be
 * attached is dropped with a note.
 */
export function useUploads(
  projectId: string,
  onProblem: (problem: UploadProblem, name: string) => void,
): Uploads {
  const [items, setItems] = useState<readonly PendingUpload[]>([]);
  // The list as it is right now, also between renders: uploads finish at any time.
  const current = useRef<readonly PendingUpload[]>([]);
  const commit = useCallback((next: readonly PendingUpload[]) => {
    current.current = next;
    setItems(next);
  }, []);

  const discard = useCallback(
    (fileId: string) => {
      // Best effort: an upload that stays is removed by the server after a day.
      void api(filePath(projectId, fileId), { method: 'DELETE' }).catch(() => undefined);
    },
    [projectId],
  );

  const add = useCallback(
    (files: readonly File[]) => {
      for (const file of files) {
        if (current.current.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
          onProblem('too_many', file.name);
          return;
        }
        if (file.size > MAX_FILE_BYTES) {
          onProblem('too_large', file.name);
          continue;
        }
        const localId = crypto.randomUUID();
        commit([
          ...current.current,
          { localId, name: file.name, sizeBytes: file.size, status: 'uploading' },
        ]);
        const form = new FormData();
        form.set('file', file);
        const stillWanted = () => current.current.some((item) => item.localId === localId);
        api<MessageAttachment>(`/projects/${encodeURIComponent(projectId)}/files`, {
          method: 'POST',
          body: form,
        }).then(
          (attachment) => {
            // Taken off while it was on its way: the upload is of no use any more.
            if (!stillWanted()) {
              discard(attachment.id);
              return;
            }
            commit(
              current.current.map((item) =>
                item.localId === localId ? { ...item, status: 'done', attachment } : item,
              ),
            );
          },
          (error: unknown) => {
            if (!stillWanted()) return;
            commit(current.current.filter((item) => item.localId !== localId));
            onProblem(problemOf(error), file.name);
          },
        );
      }
    },
    [projectId, onProblem, commit, discard],
  );

  const remove = useCallback(
    (localId: string) => {
      const item = current.current.find((entry) => entry.localId === localId);
      if (!item) return;
      if (item.attachment) discard(item.attachment.id);
      commit(current.current.filter((entry) => entry.localId !== localId));
    },
    [commit, discard],
  );

  const clear = useCallback(() => {
    commit([]);
  }, [commit]);

  return useMemo(
    () => ({
      items,
      attachments: items.flatMap((item) => (item.attachment ? [item.attachment] : [])),
      uploading: items.some((item) => item.status === 'uploading'),
      add,
      remove,
      clear,
    }),
    [items, add, remove, clear],
  );
}
