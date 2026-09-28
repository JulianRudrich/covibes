import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Logo } from '@web/components/logo';
import { Button } from '@web/components/ui/button';
import { Card, Notice } from '@web/components/ui/card';
import { Input, Label } from '@web/components/ui/input';
import { authErrorKey, redirectErrorKey, type AuthErrorKey } from '@web/features/auth/auth-errors';
import { safeRedirectPath } from '@web/features/auth/redirect-path';
import { configQuery } from '@web/features/auth/session';
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
    <main className="grid min-h-dvh place-items-center bg-bg-app p-6 text-text">
      <div className="w-full max-w-[380px]">
        <div className="mb-5 flex items-center justify-center gap-2.5">
          <Logo />
          <span className="text-display font-semibold tracking-[-0.02em]">
            {t('common.wordmark')}
          </span>
        </div>
        <Card className="p-6">
          <h1 className="m-0 text-display font-semibold">{t('auth.title')}</h1>
          <p className="mt-1 mb-5 text-ui text-text-3">{t('auth.subtitle')}</p>

          {error ? (
            <Notice id="login-error" tone="danger" className="mb-4">
              {t(error)}
            </Notice>
          ) : null}

          <Button
            className="w-full"
            disabled={!gitlabReady}
            aria-describedby={gitlabReady ? undefined : 'gitlab-hint'}
            onClick={() => void signInWithGitlab()}
          >
            {t('auth.gitlab')}
          </Button>
          {gitlabReady ? null : (
            <p id="gitlab-hint" className="mt-2 mb-0 text-small text-text-3">
              {t('auth.gitlabUnavailable')}
            </p>
          )}

          {emailReady ? (
            <>
              <div className="my-5 flex items-center gap-3 text-small text-text-4">
                <span aria-hidden="true" className="h-px flex-1 bg-border" />
                {t('auth.or')}
                <span aria-hidden="true" className="h-px flex-1 bg-border" />
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
                    onClick={() => {
                      setSentTo(undefined);
                    }}
                  >
                    {t('auth.otherEmail')}
                  </Button>
                </div>
              ) : (
                <form className="grid gap-2" noValidate onSubmit={(event) => void sendLink(event)}>
                  <Label htmlFor="login-email">{t('auth.emailLabel')}</Label>
                  <Input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    placeholder={t('auth.emailPlaceholder')}
                    value={email}
                    aria-invalid={error === 'auth.errors.invalidEmail'}
                    aria-describedby={error ? 'login-error' : undefined}
                    onChange={(event) => {
                      setEmail(event.target.value);
                    }}
                  />
                  <Button
                    variant="primary"
                    type="submit"
                    className="mt-1 w-full"
                    disabled={sending}
                  >
                    {sending ? t('auth.sending') : t('auth.sendLink')}
                  </Button>
                </form>
              )}
            </>
          ) : null}
        </Card>
      </div>
    </main>
  );
}
