import type { PublicConfig } from '@covibes/shared';
import { queryOptions } from '@tanstack/react-query';

import { api } from '@web/lib/api';
import { authClient } from '@web/lib/auth-client';

export type SessionUser = { id: string; name: string; email: string };

/** The signed-in user or null. Route guards and the account menu share this query. */
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: async (): Promise<SessionUser | null> => {
    const { data, error } = await authClient.getSession();
    if (error) throw new Error(`Session could not be loaded (${String(error.status)})`);
    return data ? { id: data.user.id, name: data.user.name, email: data.user.email } : null;
  },
  staleTime: 60_000,
});

/** Settings the login page needs before anyone is signed in. */
export const configQuery = queryOptions({
  queryKey: ['config'],
  queryFn: () => api<PublicConfig>('/config'),
  staleTime: Infinity,
});
