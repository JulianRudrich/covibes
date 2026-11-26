import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { AppHeader } from '@web/components/app-header';
import { Card } from '@web/components/ui/card';
import { Input, Label } from '@web/components/ui/input';
import { configQuery, sessionQuery, type SessionUser } from '@web/features/auth/session';
import { downloadText } from '@web/features/export/download';
import { api } from '@web/lib/api';
import { authClient } from '@web/lib/auth-client';

export function AccountPage() {
  const user = useQuery(sessionQuery).data;
  return user ? <AccountSettings key={user.id} user={user} /> : null;
}

/** Accessible account controls on the existing Studio surfaces. */
export function AccountSettings({ user }: { user: SessionUser }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const config = useQuery(configQuery).data;
  const [name, setName] = useState(user.name);
  const [passkeyName, setPasskeyName] = useState('');
  const [code, setCode] = useState('');
  const [totpUri, setTotpUri] = useState<string>();
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<
    'saved' | 'failed' | 'deletionSent' | 'ownershipBlocked' | 'freshSignInRequired' | undefined
  >();
  const current = authClient.useSession().data?.session.id;
  const sessions = useQuery({
    queryKey: ['account', user.id, 'sessions'],
    queryFn: async () => {
      const result = await authClient.listSessions();
      if (result.error) throw new Error('Sessions unavailable');
      return result.data;
    },
  });
  const passkeys = useQuery({
    queryKey: ['account', user.id, 'passkeys'],
    queryFn: async () => {
      const result = await authClient.passkey.listUserPasskeys();
      if (result.error) throw new Error('Passkeys unavailable');
      return result.data;
    },
  });

  async function perform(action: () => Promise<void>) {
    setBusy(true);
    setFeedback(undefined);
    try {
      await action();
      await client.invalidateQueries({ queryKey: ['account', user.id] });
      await client.invalidateQueries({ queryKey: sessionQuery.queryKey });
      setFeedback('saved');
    } catch {
      setFeedback('failed');
    } finally {
      setBusy(false);
    }
  }

  async function saveName(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => {
      const result = await authClient.updateUser({ name: name.trim() });
      if (result.error) throw new Error('Update failed');
    });
  }

  async function setupTotp() {
    await perform(async () => {
      const result = await authClient.twoFactor.enable({ password: '', method: 'totp' });
      if (result.error || result.data.method !== 'totp') throw new Error('Setup failed');
      setTotpUri(result.data.totpURI);
      setBackupCodes(result.data.backupCodes);
    });
  }

  async function verifyTotp(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => {
      const result = await authClient.twoFactor.verifyTotp({ code });
      if (result.error) throw new Error('Verification failed');
      setTotpUri(undefined);
      setCode('');
    });
  }

  async function removeAccount() {
    setBusy(true);
    setFeedback(undefined);
    try {
      const result = await authClient.deleteUser({ callbackURL: '/login' });
      if (result.error) {
        const code = String(result.error.code);
        if (code === 'LAST_OWNER') {
          setFeedback('ownershipBlocked');
          return;
        }
        if (code === 'SESSION_EXPIRED') {
          setFeedback('freshSignInRequired');
          return;
        }
        throw new Error('Deletion failed');
      }
      if (config?.emailLogin === false) {
        client.clear();
        window.location.assign('/login');
      } else setFeedback('deletionSent');
    } catch {
      setFeedback('failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-bg-app text-text">
      <AppHeader />
      <main
        className="mx-auto grid w-full max-w-[900px] gap-5 px-6 pt-6 pb-16 max-md:px-4"
        aria-busy={busy}
      >
        <Link to="/">{t('accountSecurity.backToProjects')}</Link>
        <h1 className="m-0 font-display text-[34px] font-semibold tracking-[-0.03em]">
          {t('accountSecurity.settings')}
        </h1>
        {feedback ? (
          <p
            role={
              ['failed', 'ownershipBlocked', 'freshSignInRequired'].includes(feedback)
                ? 'alert'
                : 'status'
            }
          >
            {t(`accountSecurity.${feedback}`)}
          </p>
        ) : null}
        {feedback === 'freshSignInRequired' ? (
          <Button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const result = await authClient.signOut();
                if (result.error) throw new Error('Sign out failed');
                client.clear();
                window.location.assign('/login?redirect=%2Faccount');
              })
            }
          >
            {t('accountSecurity.signInAgain')}
          </Button>
        ) : null}
        <Card role="region" aria-labelledby="profile-heading" className="grid gap-3 p-6 max-md:p-5">
          <h2
            id="profile-heading"
            className="m-0 font-display text-heading font-semibold tracking-[-0.01em]"
          >
            {t('accountSecurity.profile')}
          </h2>
          <p>{user.email}</p>
          <form onSubmit={(event) => void saveName(event)} className="grid gap-3">
            <Label htmlFor="account-name">{t('accountSecurity.name')}</Label>
            <Input
              id="account-name"
              autoComplete="name"
              value={name}
              maxLength={80}
              required
              onChange={(event) => {
                setName(event.target.value);
              }}
            />
            <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
              {t('accountSecurity.save')}
            </Button>
          </form>
        </Card>
        <Card
          role="region"
          aria-labelledby="sessions-heading"
          className="grid gap-3 p-6 max-md:p-5"
        >
          <h2
            id="sessions-heading"
            className="m-0 font-display text-heading font-semibold tracking-[-0.01em]"
          >
            {t('accountSecurity.sessions')}
          </h2>
          {sessions.isError ? (
            <p role="alert">{t('accountSecurity.failed')}</p>
          ) : (
            <ul className="grid gap-3">
              {(sessions.data ?? []).map((session) => (
                <li key={session.id}>
                  <p>
                    {session.userAgent || t('accountSecurity.unknownDevice')}
                    {session.id === current ? ` — ${t('accountSecurity.currentSession')}` : ''}
                  </p>
                  <p>{new Date(session.createdAt).toLocaleString()}</p>
                  {session.id !== current ? (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void perform(async () => {
                          const result = await authClient.revokeSession({ token: session.token });
                          if (result.error) throw new Error('Revocation failed');
                        })
                      }
                    >
                      {t('accountSecurity.revoke')}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <Button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const result = await authClient.revokeOtherSessions();
                if (result.error) throw new Error('Revocation failed');
              })
            }
          >
            {t('accountSecurity.revokeOthers')}
          </Button>
        </Card>
        <Card
          role="region"
          aria-labelledby="passkeys-heading"
          className="grid gap-3 p-6 max-md:p-5"
        >
          <h2
            id="passkeys-heading"
            className="m-0 font-display text-heading font-semibold tracking-[-0.01em]"
          >
            {t('accountSecurity.passkeys')}
          </h2>
          <p>{t('accountSecurity.passkeyDescription')}</p>
          {passkeys.isError ? (
            <p role="alert">{t('accountSecurity.failed')}</p>
          ) : (
            <ul>
              {(passkeys.data ?? []).map((key) => (
                <li key={key.id} className="flex items-center justify-between gap-3">
                  <span>{key.name || t('accountSecurity.unnamedPasskey')}</span>
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void perform(async () => {
                        const result = await authClient.passkey.deletePasskey({ id: key.id });
                        if (result.error) throw new Error('Removal failed');
                      })
                    }
                  >
                    {t('accountSecurity.remove')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Label htmlFor="passkey-name">{t('accountSecurity.passkeyName')}</Label>
          <Input
            id="passkey-name"
            value={passkeyName}
            maxLength={80}
            onChange={(event) => {
              setPasskeyName(event.target.value);
            }}
          />
          <Button
            disabled={busy || !('PublicKeyCredential' in window)}
            onClick={() =>
              void perform(async () => {
                const result = await authClient.passkey.addPasskey({
                  name: passkeyName.trim() || undefined,
                });
                if (result.error) throw new Error('Registration failed');
                setPasskeyName('');
              })
            }
          >
            {t('accountSecurity.addPasskey')}
          </Button>
        </Card>
        <Card
          role="region"
          aria-labelledby="two-factor-heading"
          className="grid gap-3 p-6 max-md:p-5"
        >
          <h2
            id="two-factor-heading"
            className="m-0 font-display text-heading font-semibold tracking-[-0.01em]"
          >
            {t('accountSecurity.twoFactor')}
          </h2>
          <p>
            {t(
              user.twoFactorEnabled
                ? 'accountSecurity.twoFactorEnabled'
                : 'accountSecurity.twoFactorDescription',
            )}
          </p>
          {user.twoFactorEnabled ? (
            <Button
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  const result = await authClient.twoFactor.disable({ password: '' });
                  if (result.error) throw new Error('Disable failed');
                  setBackupCodes([]);
                })
              }
            >
              {t('accountSecurity.disableTwoFactor')}
            </Button>
          ) : !totpUri ? (
            <Button disabled={busy} onClick={() => void setupTotp()}>
              {t('accountSecurity.setupTwoFactor')}
            </Button>
          ) : null}
          {totpUri ? (
            <form className="grid gap-3" onSubmit={(event) => void verifyTotp(event)}>
              <p>{t('accountSecurity.setupInstructions')}</p>
              <Label htmlFor="totp-uri">{t('accountSecurity.authenticatorUri')}</Label>
              <Input id="totp-uri" value={totpUri} readOnly autoComplete="off" />
              <Label htmlFor="totp-secret">{t('accountSecurity.manualSetupKey')}</Label>
              <Input
                id="totp-secret"
                value={new URL(totpUri).searchParams.get('secret') ?? ''}
                readOnly
                autoComplete="off"
                spellCheck={false}
              />
              <Label htmlFor="totp-code">{t('accountSecurity.code')}</Label>
              <Input
                id="totp-code"
                value={code}
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                onChange={(event) => {
                  setCode(event.target.value);
                }}
              />
              <Button type="submit" disabled={busy}>
                {t('accountSecurity.verify')}
              </Button>
            </form>
          ) : null}
          {backupCodes.length ? (
            <div className="grid gap-3">
              <p>{t('accountSecurity.saveRecovery')}</p>
              <pre className="whitespace-pre-wrap">{backupCodes.join('\n')}</pre>
              <Button
                onClick={() => {
                  downloadText(backupCodes.join('\n'), 'covibes-recovery-codes.txt', 'text/plain');
                }}
              >
                {t('accountSecurity.downloadRecovery')}
              </Button>
              <Button
                variant="ghost"
                onClick={() => {
                  setBackupCodes([]);
                }}
              >
                {t('accountSecurity.hideRecovery')}
              </Button>
            </div>
          ) : null}
        </Card>
        <Card role="region" aria-labelledby="data-heading" className="grid gap-3 p-6 max-md:p-5">
          <h2
            id="data-heading"
            className="m-0 font-display text-heading font-semibold tracking-[-0.01em]"
          >
            {t('accountSecurity.personalData')}
          </h2>
          <p>{t('accountSecurity.exportDescription')}</p>
          <Button
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const exported = await api<unknown>('/account/export');
                downloadText(
                  JSON.stringify(exported, null, 2),
                  'covibes-personal-data.json',
                  'application/json',
                );
              })
            }
          >
            {t('accountSecurity.export')}
          </Button>
          <h3>{t('accountSecurity.deleteAccount')}</h3>
          <p>{t('accountSecurity.deleteDescription')}</p>
          <Label htmlFor="delete-confirmation">{t('accountSecurity.confirmEmail')}</Label>
          <Input
            id="delete-confirmation"
            autoComplete="off"
            value={confirmation}
            onChange={(event) => {
              setConfirmation(event.target.value);
            }}
          />
          <Button
            variant="danger"
            disabled={busy || confirmation.trim().toLowerCase() !== user.email.toLowerCase()}
            onClick={() => void removeAccount()}
          >
            {t('accountSecurity.requestDeletion')}
          </Button>
        </Card>
      </main>
    </div>
  );
}
