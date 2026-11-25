import { useQuery } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Button } from '@web/components/ui/button';
import { Input, Label } from '@web/components/ui/input';
import { LanguageSwitch } from '@web/features/account/language-switch';
import { redirectErrorKey, type AuthErrorKey } from '@web/features/auth/auth-errors';
import { safeRedirectPath } from '@web/features/auth/redirect-path';
import { configQuery } from '@web/features/auth/session';
import { currentLanguage } from '@web/i18n/language';
import { authClient } from '@web/lib/auth-client';

const route = getRouteApi('/login');

function needsSecondFactor(data: unknown): boolean {
  return (
    typeof data === 'object' &&
    data !== null &&
    'twoFactorRedirect' in data &&
    data.twoFactorRedirect === true
  );
}

/** Functional account flow; spec 55 supplies the new visual system. */
export function LoginPage() {
  const { t } = useTranslation();
  const search = route.useSearch();
  const config = useQuery(configQuery).data;
  const target = safeRedirectPath(search.redirect) ?? '/';
  const errorCallbackURL =
    target === '/' ? '/login' : `/login?redirect=${encodeURIComponent(target)}`;
  const [email, setEmail] = useState('');
  const [chosenMethod, setMethod] = useState<'code' | 'link'>();
  const method = chosenMethod ?? (config?.emailCodeLogin ? 'code' : 'link');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [secondFactor, setSecondFactor] = useState(search.twoFactor === 'required');
  const [recovery, setRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthErrorKey | 'accountSecurity.authFailed' | undefined>(
    search.error ? redirectErrorKey(search.error) : undefined,
  );
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (secondFactor || (sent && method === 'code')) codeInput.current?.focus();
  }, [secondFactor, sent, method, recovery]);

  function complete(data: unknown) {
    if (needsSecondFactor(data)) {
      setSecondFactor(true);
      setCode('');
    } else window.location.assign(target);
  }

  function failed(reason: unknown) {
    const detail = reason instanceof Error && reason.cause ? reason.cause : reason;
    const limited =
      typeof detail === 'object' && detail !== null && 'status' in detail && detail.status === 429;
    setError(limited ? 'auth.errors.rateLimit' : 'accountSecurity.authFailed');
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      if (secondFactor) {
        const result = recovery
          ? await authClient.twoFactor.verifyBackupCode({ code })
          : await authClient.twoFactor.verifyTotp({ code });
        if (result.error) throw new Error('Verification failed', { cause: result.error });
        complete(result.data);
      } else if (sent && method === 'code') {
        const result = await authClient.signIn.emailOtp({ email: email.trim(), otp: code });
        if (result.error) throw new Error('Verification failed', { cause: result.error });
        complete(result.data);
      } else {
        if (!z.email().safeParse(email.trim()).success) {
          setError('auth.errors.invalidEmail');
          return;
        }
        const result =
          method === 'code'
            ? await authClient.emailOtp.sendVerificationOtp(
                { email: email.trim(), type: 'sign-in' },
                { headers: { 'accept-language': currentLanguage() } },
              )
            : await authClient.signIn.magicLink({
                email: email.trim(),
                callbackURL: target,
                errorCallbackURL,
                metadata: { language: currentLanguage() },
              });
        if (result.error) throw new Error('Request failed', { cause: result.error });
        setSent(true);
      }
    } catch (reason) {
      failed(reason);
    } finally {
      setBusy(false);
    }
  }

  async function social(provider: 'github' | 'google' | 'gitlab') {
    setError(undefined);
    setBusy(true);
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: target,
        errorCallbackURL,
      });
      if (result.error) failed(result.error);
    } catch (reason) {
      failed(reason);
    } finally {
      setBusy(false);
    }
  }

  async function signInPasskey() {
    setError(undefined);
    setBusy(true);
    try {
      const result = await authClient.signIn.passkey();
      if (result.error) failed(result.error);
      else complete(result.data);
    } catch (reason) {
      failed(reason);
    } finally {
      setBusy(false);
    }
  }

  const providers = config?.socialLogins ?? (config?.gitlabLogin ? (['gitlab'] as const) : []);
  const emailReady = config?.emailLogin !== false;
  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 p-6">
      <Link to="/">{t('common.appName')}</Link>
      <h1 className="text-2xl font-semibold">
        {secondFactor ? t('accountSecurity.challengeTitle') : t('auth.title')}
      </h1>
      {config?.closedBeta ? <p>{t('accountSecurity.betaNotice')}</p> : null}
      {target.startsWith('/invite/') ? <p>{t('auth.invited')}</p> : null}
      {error ? <p role="alert">{t(error)}</p> : null}
      {!secondFactor ? (
        <div className="grid gap-3">
          {providers.map((provider) => (
            <Button key={provider} disabled={busy} onClick={() => void social(provider)}>
              {t('accountSecurity.social', {
                provider: { github: 'GitHub', google: 'Google', gitlab: 'GitLab' }[provider],
              })}
            </Button>
          ))}
          {config?.passkeyLogin ? (
            <Button
              disabled={busy || !('PublicKeyCredential' in window)}
              onClick={() => void signInPasskey()}
            >
              {t('accountSecurity.passkeySignIn')}
            </Button>
          ) : null}
        </div>
      ) : null}
      {emailReady || secondFactor ? (
        <form
          noValidate
          onSubmit={(event) => void submit(event)}
          aria-busy={busy}
          className="grid gap-3"
        >
          {!secondFactor ? (
            <>
              <Label htmlFor="login-email">{t('auth.emailLabel')}</Label>
              <Input
                id="login-email"
                type="email"
                autoComplete="username webauthn"
                value={email}
                required
                disabled={sent || busy}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
              />
              {!sent ? (
                <fieldset className="flex gap-4">
                  <legend>{t('accountSecurity.emailMethod')}</legend>
                  {(config?.emailCodeLogin ? (['code', 'link'] as const) : (['link'] as const)).map(
                    (choice) => (
                      <label key={choice}>
                        <input
                          type="radio"
                          name="email-method"
                          value={choice}
                          checked={method === choice}
                          disabled={busy}
                          onChange={() => {
                            setMethod(choice);
                          }}
                        />{' '}
                        {t(`accountSecurity.method_${choice}`)}
                      </label>
                    ),
                  )}
                </fieldset>
              ) : null}
            </>
          ) : null}
          {sent ? (
            <p role="status">
              {t(method === 'code' ? 'accountSecurity.codeSent' : 'auth.linkSent', { email })}
            </p>
          ) : null}
          {secondFactor || (sent && method === 'code') ? (
            <>
              <Label htmlFor="login-code">
                {t(recovery ? 'accountSecurity.recoveryCode' : 'accountSecurity.code')}
              </Label>
              <Input
                id="login-code"
                ref={codeInput}
                value={code}
                autoComplete="one-time-code"
                inputMode={recovery ? 'text' : 'numeric'}
                required
                disabled={busy}
                onChange={(event) => {
                  setCode(event.target.value);
                }}
              />
            </>
          ) : null}
          {!(sent && method === 'link') ? (
            <Button type="submit" disabled={busy}>
              {busy
                ? t('common.loading')
                : t(
                    secondFactor || sent
                      ? 'accountSecurity.verify'
                      : method === 'code'
                        ? 'accountSecurity.sendCode'
                        : 'auth.sendLink',
                  )}
            </Button>
          ) : null}
          {secondFactor ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setRecovery(!recovery);
                setCode('');
              }}
            >
              {t(recovery ? 'accountSecurity.useAuthenticator' : 'accountSecurity.useRecovery')}
            </Button>
          ) : sent ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setSent(false);
                setCode('');
              }}
            >
              {t('auth.otherEmail')}
            </Button>
          ) : null}
          {config?.devMailbox ? <Link to="/dev/mails">{t('auth.openMailbox')}</Link> : null}
        </form>
      ) : null}
      <LanguageSwitch />
    </main>
  );
}
