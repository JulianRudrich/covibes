import { formatFileSize, type MessageAttachment } from '@covibes/shared';
import { FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { fileUrl } from '@web/features/files/use-uploads';

/**
 * The files of a chat message (spec 20a, derived look): images as thumbnails that open in a new
 * tab, everything else as a chip with icon, name and size that downloads the file.
 */
export function AttachmentList({
  projectId,
  attachments,
}: {
  projectId: string;
  attachments: readonly MessageAttachment[];
}) {
  const { t, i18n } = useTranslation();
  if (attachments.length === 0) return null;
  const images = attachments.filter((file) => file.kind === 'image');
  const others = attachments.filter((file) => file.kind !== 'image');

  return (
    <div className="flex flex-col gap-1.5">
      {images.length > 0 ? (
        <ul aria-label={t('files.images')} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {images.map((file) => (
            <li key={file.id}>
              <a
                href={fileUrl(projectId, file.id)}
                target="_blank"
                rel="noreferrer"
                aria-label={t('files.open', { name: file.name })}
                className="block overflow-hidden rounded-md border border-border-soft bg-bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                <img
                  src={fileUrl(projectId, file.id)}
                  alt={file.name}
                  loading="lazy"
                  className="block max-h-[160px] max-w-[220px] object-contain"
                />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {others.length > 0 ? (
        <ul aria-label={t('files.files')} className="m-0 flex list-none flex-wrap gap-1.5 p-0">
          {others.map((file) => (
            <li key={file.id} className="min-w-0 max-w-full">
              <a
                href={fileUrl(projectId, file.id)}
                download={file.name}
                aria-label={t('files.download', { name: file.name })}
                className="flex h-[34px] max-w-full items-center gap-2 rounded-md border border-border-soft bg-bg-muted pr-2.5 pl-2 text-small text-text-body no-underline hover:bg-bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                <FileText size={15} className="shrink-0 text-text-3" aria-hidden="true" />
                <span className="min-w-0 truncate font-medium">{file.name}</span>
                <span className="shrink-0 text-meta text-text-3 tabular-nums">
                  {formatFileSize(file.sizeBytes, i18n.language)}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
