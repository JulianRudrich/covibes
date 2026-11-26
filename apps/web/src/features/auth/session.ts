import { isLanguage, type Language, type PublicConfig } from '@covibes/shared';
import { queryOptions } from '@tanstack/react-query';

import { api } from '@web/lib/api';
import { authClient } from '@web/lib/auth-client';

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  /** The language of the account (spec 32a); the interface follows it. */
  locale?: Language;
  twoFactorEnabled?: boolean;
};

/** The signed-in user or null. Route guards and the account menu share this query. */
export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: async (): Promise<SessionUser | null> => {
    const { data, error } = await authClient.getSession();
    if (error) throw new Error(`Session could not be loaded (${String(error.status)})`);
    if (!data) return null;
    const { id, name, email, locale, twoFactorEnabled } = data.user;
    return {
      id,
      name,
      email,
      twoFactorEnabled: twoFactorEnabled === true,
      ...(isLanguage(locale) ? { locale } : {}),
    };
  },
  staleTime: 60_000,
});

/** Settings the login page needs before anyone is signed in. */
export const configQuery = queryOptions({
  queryKey: ['config'],
  queryFn: () => api<PublicConfig>('/config'),
  staleTime: Infinity,
});
