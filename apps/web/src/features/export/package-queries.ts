import type { CodingPackageOverview, PackageTextKind } from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query';

import { downloadBlob } from '@web/features/export/download';
import { api, ApiError } from '@web/lib/api';

export function packageQueryKey(projectId: string) {
  return ['projects', projectId, 'package'] as const;
}

const base = (projectId: string) => `/projects/${encodeURIComponent(projectId)}/package`;

/**
 * What the package for coding agents holds right now (spec 27b), with the team's two texts. The
 * export dialog loads it whenever it opens: it is a picture of the project as it stands, so
 * nothing of it is kept for the next time.
 */
export function packageQuery(projectId: string) {
  return queryOptions({
    queryKey: packageQueryKey(projectId),
    queryFn: () => api<CodingPackageOverview>(base(projectId)),
    staleTime: 0,
    gcTime: 0,
  });
}

/** Stores one of the team's texts; an empty one removes it. */
export function savePackageText(projectId: string, kind: PackageTextKind, content: string) {
  return api<undefined>(`${base(projectId)}/texts/${kind}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

/** Stores one of the team's texts for the open dialog, which shows it as stored. */
export function useSavePackageText(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, content }: { kind: PackageTextKind; content: string }) =>
      savePackageText(projectId, kind, content),
    onSuccess: (_, { kind, content }) => {
      queryClient.setQueryData(packageQuery(projectId).queryKey, (overview) =>
        overview ? { ...overview, texts: { ...overview.texts, [kind]: content } } : overview,
      );
    },
  });
}

/** Downloads the package: the server builds the ZIP and names it after the project. */
export async function downloadPackage(projectId: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`/api${base(projectId)}/download`, { credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network');
  }
  if (!response.ok) throw new ApiError(response.status, 'internal');
  const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1];
  downloadBlob(await response.blob(), name ?? 'package.zip');
}
