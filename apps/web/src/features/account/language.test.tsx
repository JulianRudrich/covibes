import type { Language } from '@covibes/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AccountLanguage } from '@web/features/account/language';
import { LanguageSwitch } from '@web/features/account/language-switch';
import { sessionQuery, type SessionUser } from '@web/features/auth/session';
import { currentLanguage, keepChoice, openChoice, showLanguage } from '@web/i18n/language';
import { authClient } from '@web/lib/auth-client';

vi.mock('@web/lib/auth-client', () => ({
  authClient: { getSession: vi.fn(), updateUser: vi.fn() },
}));

// The interface follows the language of the account, and a choice made signed out goes into the
// account (spec 32a).
const OLGA = {
  id: '5d1f0a5e-2f3b-4a53-9a44-0f6f4f4e8a01',
  name: 'Olga',
  email: 'olga@example.com',
};
const updateUser = vi.mocked(authClient.updateUser);

function saves(outcome: 'ok' | 'refused' | 'offline' = 'ok') {
  updateUser.mockReset();
  if (outcome === 'offline') updateUser.mockRejectedValue(new Error('offline'));
  else {
    updateUser.mockResolvedValue(
      (outcome === 'ok'
        ? { data: { status: true }, error: null }
        : { data: null, error: { status: 400, statusText: 'Bad Request' } }) as Awaited<
        ReturnType<typeof authClient.updateUser>
      >,
    );
  }
}

/** Renders the app's language keeper and the switch; `user` is who the pages found signed in. */
function renderLanguage(user: SessionUser | null | undefined) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (user !== undefined) queryClient.setQueryData(sessionQuery.queryKey, user);
  render(
    <QueryClientProvider client={queryClient}>
      <AccountLanguage />
      <LanguageSwitch />
    </QueryClientProvider>,
  );
  return {
    /** The pages load the session, e.g. after signing in. */
    signIn: (next: SessionUser) => {
      queryClient.setQueryData(sessionQuery.queryKey, next);
    },
    session: () => queryClient.getQueryData(sessionQuery.queryKey),
  };
}

const button = (language: 'Deutsch' | 'English') => screen.getByRole('button', { name: language });
const account = (locale: Language): SessionUser => ({ ...OLGA, locale });

describe('the language of the interface', () => {
  it('is the language of the account once the session is known', async () => {
    saves();
    renderLanguage(account('en'));

    await waitFor(() => {
      expect(currentLanguage()).toBe('en');
    });
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('group', { name: 'Language' })).toBeInTheDocument();
    // The device remembers it for the pages someone sees signed out.
    expect(window.localStorage.getItem('covibes.language')).toBe('en');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('follows the account, not what the device showed last', async () => {
    saves();
    showLanguage('en');
    const { signIn } = renderLanguage(null);
    expect(currentLanguage()).toBe('en');

    signIn(account('de'));

    await waitFor(() => {
      expect(currentLanguage()).toBe('de');
    });
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('stays as it is while nobody is signed in, or the session names no language', () => {
    saves();
    showLanguage('en');
    const { signIn } = renderLanguage(undefined);

    signIn(OLGA);

    expect(currentLanguage()).toBe('en');
    expect(updateUser).not.toHaveBeenCalled();
  });
});

describe('a language picked while signed out', () => {
  it('shows at once and waits for an account', () => {
    saves();
    renderLanguage(null);
    expect(button('Deutsch')).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(button('English'));

    expect(currentLanguage()).toBe('en');
    expect(button('English')).toHaveAttribute('aria-pressed', 'true');
    expect(button('Deutsch')).toHaveAttribute('aria-pressed', 'false');
    expect(openChoice()).toBe('en');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it('is taken into the account at the next sign-in', async () => {
    saves();
    const { signIn, session } = renderLanguage(null);
    fireEvent.click(button('English'));

    signIn(account('de'));

    await waitFor(() => {
      expect(updateUser).toHaveBeenCalledWith({ locale: 'en' });
    });
    await waitFor(() => {
      expect(session()).toEqual(account('en'));
    });
    expect(currentLanguage()).toBe('en');
    expect(openChoice()).toBeNull();
    expect(updateUser).toHaveBeenCalledTimes(1);
  });

  it('is settled without a request when the account holds that language already', async () => {
    saves();
    keepChoice('en');
    renderLanguage(account('en'));

    await waitFor(() => {
      expect(openChoice()).toBeNull();
    });
    expect(currentLanguage()).toBe('en');
    expect(updateUser).not.toHaveBeenCalled();
  });

  it.each(['refused', 'offline'] as const)(
    'stays open when the account could not take it (%s), and is tried again',
    async (outcome) => {
      saves(outcome);
      keepChoice('en');
      const { session } = renderLanguage(account('de'));

      await waitFor(() => {
        expect(updateUser).toHaveBeenCalledWith({ locale: 'en' });
      });
      // What the person picked stays on the screen.
      expect(currentLanguage()).toBe('en');
      expect(session()).toEqual(account('de'));
      expect(openChoice()).toBe('en');
    },
  );
});

describe('a language picked while signed in', () => {
  it('shows at once and is written to the account', async () => {
    saves();
    const { session } = renderLanguage(account('de'));
    await waitFor(() => {
      expect(button('Deutsch')).toHaveAttribute('aria-pressed', 'true');
    });

    fireEvent.click(button('English'));

    expect(currentLanguage()).toBe('en');
    expect(updateUser).toHaveBeenCalledWith({ locale: 'en' });
    await waitFor(() => {
      expect(session()).toEqual(account('en'));
    });
    expect(openChoice()).toBeNull();
  });

  it('names each language in its own language', () => {
    saves();
    renderLanguage(null);

    expect(button('Deutsch')).toHaveAttribute('lang', 'de');
    expect(button('English')).toHaveAttribute('lang', 'en');
  });
});
