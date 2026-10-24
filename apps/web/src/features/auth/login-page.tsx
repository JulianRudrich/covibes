import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { GitBranch } from 'lucide-react';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Logo } from '@web/components/logo';
import { Button } from '@web/components/ui/button';
import { Notice } from '@web/components/ui/card';
import { Input, Label } from '@web/components/ui/input';
import { LanguageSwitch } from '@web/features/account/language-switch';
import { authErrorKey, redirectErrorKey, type AuthErrorKey } from '@web/features/auth/auth-errors';
import { LoginScene } from '@web/features/auth/login-scene';
import { safeRedirectPath } from '@web/features/auth/redirect-path';
import { configQuery } from '@web/features/auth/session';
import { currentLanguage } from '@web/i18n/language';
import { authClient } from '@web/lib/auth-client';

const route = getRouteApi('/login');
const emailSchema = z.email();

export function LoginPage() {
  const { t } = useTranslation();
  const search = route.useSearch();
  const config = useQuery(configQuery).data;
  const target = safeRedirectPath(search.redirect) ?? '/';
  // Failed links come back to this page with the same target, so a retry still ends up there.
  const errorCallbackURL =
    target === '/' ? '/login' : `/login?redirect=${encodeURIComponent(target)}`;

  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string>();
  const [error, setError] = useState<AuthErrorKey | undefined>(
    search.error ? redirectErrorKey(search.error) : undefined,
  );

  async function sendLink(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();
    if (!emailSchema.safeParse(address).success) {
      setError('auth.errors.invalidEmail');
      return;
    }
    setSending(true);
    setError(undefined);
    const result = await authClient.signIn.magicLink({
      email: address,
      callbackURL: target,
      errorCallbackURL,
      // The mail with the link is written in the language of this page (spec 32a).
      metadata: { language: currentLanguage() },
    });
    setSending(false);
    if (result.error) setError(authErrorKey(result.error));
    else setSentTo(address);
  }

  async function signInWithGitlab() {
    setError(undefined);
    const result = await authClient.signIn.social({
      provider: 'gitlab',
      callbackURL: target,
      errorCallbackURL,
    });
    if (result.error) setError(authErrorKey(result.error));
  }

  const gitlabReady = config?.gitlabLogin === true;
  // Without SMTP in production there is no login link by mail (spec 02b).
  const emailReady = config?.emailLogin !== false;

  return (
    <main className="grid min-h-dvh grid-cols-[minmax(0,1fr)_560px] bg-bg-app text-text max-[960px]:grid-cols-1">
      <div className="contents max-[960px]:hidden">
        <LoginScene />
      </div>
      <section
        aria-labelledby="login-title"
        className="flex flex-col justify-center px-[88px] py-10 max-[960px]:items-center max-[960px]:px-6"
      >
        <div className="w-full max-w-[384px]">
          {/* Without the scene the brand stands above the form. */}
          <div className="mb-10 hidden items-center gap-2.5 max-[960px]:flex">
            <Logo />
            <span className="font-display text-[18px] font-bold tracking-[-0.025em]">
              {t('common.wordmark')}
            </span>
          </div>
          <h2
            id="login-title"
            className="m-0 font-display text-[28px] font-semibold tracking-[-0.02em]"
          >
            {t('auth.title')}
          </h2>
          <p className="mt-2 mb-7 text-body text-text-3">{t('auth.subtitle')}</p>

          {target.startsWith('/invite/') ? (
            <Notice className="mb-4">{t('auth.invited')}</Notice>
          ) : null}

          {error ? (
            <Notice id="login-error" tone="danger" className="mb-4">
              {t(error)}
            </Notice>
          ) : null}

          <Button
            size="l"
            className="w-full"
            disabled={!gitlabReady}
            aria-describedby={gitlabReady ? undefined : 'gitlab-hint'}
            onClick={() => void signInWithGitlab()}
          >
            <GitBranch size={17} strokeWidth={2} aria-hidden="true" />
            {t('auth.gitlab')}
          </Button>
          {gitlabReady ? null : (
            <p id="gitlab-hint" className="mt-2 mb-0 text-small text-text-3">
              {t('auth.gitlabUnavailable')}
            </p>
          )}

          {emailReady ? (
            <>
              <div className="my-[22px] flex items-center gap-3 text-small text-text-3">
                <span aria-hidden="true" className="h-px flex-1 bg-border-strong" />
                {t('auth.or')}
                <span aria-hidden="true" className="h-px flex-1 bg-border-strong" />
              </div>

              {sentTo ? (
                <div className="grid gap-3">
                  <Notice tone="success">{t('auth.linkSent', { email: sentTo })}</Notice>
                  {config?.devMailbox ? (
                    <Link to="/dev/mails" className="text-ui">
                      {t('auth.openMailbox')}
                    </Link>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="l"
                    onClick={() => {
                      setSentTo(undefined);
                    }}
                  >
                    {t('auth.otherEmail')}
                  </Button>
                </div>
              ) : (
                <form
                  className="grid gap-1.5"
                  noValidate
                  onSubmit={(event) => void sendLink(event)}
                >
                  <Label htmlFor="login-email" className="font-semibold">
                    {t('auth.emailLabel')}
                  </Label>
                  <Input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    placeholder={t('auth.emailPlaceholder')}
                    value={email}
                    className="h-[46px] rounded-[14px] px-4 text-[14px]"
                    aria-invalid={error === 'auth.errors.invalidEmail'}
                    aria-describedby={error ? 'login-error' : undefined}
                    onChange={(event) => {
                      setEmail(event.target.value);
                    }}
                  />
                  <Button
                    variant="primary"
                    type="submit"
                    size="l"
                    className="mt-1.5 w-full"
                    disabled={sending}
                  >
                    {sending ? t('auth.sending') : t('auth.sendLink')}
                  </Button>
                </form>
              )}
              <p className="mt-[22px] mb-0 text-small leading-normal text-text-3">
                {t('auth.noPassword')}
              </p>
            </>
          ) : null}

          <LanguageSwitch className="mt-12 -ml-1 justify-start" />
        </div>
      </section>
    </main>
  );
}
