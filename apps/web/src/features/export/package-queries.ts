import type {
  AcceptedPackageSuggestion,
  CodingPackageOverview,
  PackageSuggestion,
  PackageTextKind,
} from '@covibes/shared';
import { queryOptions, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

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

/** The overview in the cache with another state for the suggestion of one text. */
export function setPackageSuggestion(
  queryClient: QueryClient,
  projectId: string,
  kind: PackageTextKind,
  suggestion: PackageSuggestion | null,
) {
  queryClient.setQueryData(packageQuery(projectId).queryKey, (overview) =>
    overview
      ? { ...overview, suggestions: { ...overview.suggestions, [kind]: suggestion } }
      : overview,
  );
}

/**
 * Asks the moderator for a suggestion for a text (spec 27c). The dialog shows at once that it
 * writes; the suggestion follows with the live event `package`.
 */
export function useRequestPackageSuggestion(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kind: PackageTextKind) =>
      api<undefined>(`${base(projectId)}/texts/${kind}/suggestion`, { method: 'POST' }),
    onSuccess: (_, kind) => {
      setPackageSuggestion(queryClient, projectId, kind, { status: 'running' });
    },
    onError: () => {
      // Someone else may have asked in the same moment: the server knows what is true.
      void queryClient.invalidateQueries({ queryKey: packageQueryKey(projectId) });
    },
  });
}

/** Dismisses a suggestion, also one that is still being written. */
export function useDismissPackageSuggestion(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kind: PackageTextKind) =>
      api<undefined>(`${base(projectId)}/texts/${kind}/suggestion`, { method: 'DELETE' }),
    onSuccess: (_, kind) => {
      setPackageSuggestion(queryClient, projectId, kind, null);
    },
  });
}

/** Takes a written suggestion over as the team's text; the answer is that text. */
export function acceptPackageSuggestion(projectId: string, kind: PackageTextKind) {
  return api<AcceptedPackageSuggestion>(`${base(projectId)}/texts/${kind}/suggestion/accept`, {
    method: 'POST',
  });
}

/**
 * Asks the moderator to write the specs of a milestone out (spec 27d). The dialog shows at once
 * that it writes; the specs follow with the live event `package`.
 */
export function useRequestPackageSpecs(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (milestone: number) =>
      api<undefined>(`${base(projectId)}/specs/${String(milestone)}`, { method: 'POST' }),
    onSuccess: (_, milestone) => {
      queryClient.setQueryData(packageQuery(projectId).queryKey, (overview) =>
        overview
          ? {
              ...overview,
              milestoneSpecs: overview.milestoneSpecs.map((entry) =>
                entry.number === milestone
                  ? { ...entry, run: { status: 'running' as const } }
                  : entry,
              ),
            }
          : overview,
      );
    },
    onError: () => {
      // Someone else may have asked in the same moment: the server knows what is true.
      void queryClient.invalidateQueries({ queryKey: packageQueryKey(projectId) });
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
