import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@web/lib/api';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // 4xx answers (no access, not found) do not get better by asking again.
        retry: (failureCount, error) =>
          !(error instanceof ApiError && error.status >= 400 && error.status < 500) &&
          failureCount < 2,
      },
    },
  });
}
