import { isLanguage, type Language } from '@covibes/shared';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import { sessionQuery } from '@web/features/auth/session';
import { keepChoice, openChoice, settleChoice, showLanguage } from '@web/i18n/language';
import { authClient } from '@web/lib/auth-client';

/**
 * Writes a language to the account of who is signed in. If that fails, the choice stays open on
 * this device and is tried again at the next sign-in.
 */
async function saveAccountLanguage(queryClient: QueryClient, language: Language) {
  keepChoice(language);
  const result = await authClient.updateUser({ locale: language }).catch(() => null);
  if (!result || result.error) return;
  settleChoice();
  queryClient.setQueryData(sessionQuery.queryKey, (user) =>
    user ? { ...user, locale: language } : user,
  );
}

/** The session as the pages loaded it; this asks for nothing itself. */
function useKnownSession() {
  return useQuery({ ...sessionQuery, enabled: false }).data;
}

/**
 * Keeps the interface in the language of the account (spec 32a): once the session is known, the
 * account's language is shown. A language picked while signed out goes the other way: the
 * account takes it.
 */
export function useAccountLanguage() {
  const queryClient = useQueryClient();
  const user = useKnownSession();
  const userId = user?.id;
  const locale = user?.locale;

  useEffect(() => {
    if (userId === undefined || !isLanguage(locale)) return;
    const chosen = openChoice();
    if (chosen !== null && chosen !== locale) {
      void saveAccountLanguage(queryClient, chosen);
      return;
    }
    settleChoice();
    showLanguage(locale);
  }, [queryClient, userId, locale]);
}

/** Mounts `useAccountLanguage` once for the whole app. */
export function AccountLanguage() {
  useAccountLanguage();
  return null;
}

/**
 * Switches the interface to a language: for the account of who is signed in, else for this
 * device until someone signs in.
 */
export function useChooseLanguage(): (language: Language) => void {
  const queryClient = useQueryClient();
  const signedIn = useKnownSession() != null;
  return useCallback(
    (language: Language) => {
      if (signedIn) void saveAccountLanguage(queryClient, language);
      else keepChoice(language);
    },
    [queryClient, signedIn],
  );
}
