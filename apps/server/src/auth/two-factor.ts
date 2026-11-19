import { createAuthMiddleware } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins';

/** The stock plugin only intercepts password sign-in; Covibes is passwordless. */
export function isPrimarySignIn(path: string): boolean {
  return (
    path.startsWith('/callback/') ||
    path === '/magic-link/verify' ||
    path === '/sign-in/email-otp' ||
    path === '/passkey/verify-authentication'
  );
}

export function accountTwoFactor(appUrl: string) {
  const plugin = twoFactor({
    issuer: 'Covibes',
    allowPasswordless: true,
    twoFactorCookieMaxAge: 600,
    backupCodeOptions: { storeBackupCodes: 'encrypted' },
    schema: {
      user: { fields: { twoFactorEnabled: 'two_factor_enabled' } },
      twoFactor: {
        modelName: 'account_two_factors',
        fields: {
          userId: 'user_id',
          backupCodes: 'backup_codes',
          failedVerificationCount: 'failed_verification_count',
          lockedUntil: 'locked_until',
        },
      },
    },
  });
  const challenge = plugin.hooks.after[0];
  if (!challenge) throw new Error('The two-factor plugin has no sign-in challenge hook');
  return {
    ...plugin,
    hooks: {
      after: [
        {
          matcher: (context: Parameters<typeof challenge.matcher>[0]) =>
            challenge.matcher(context) || isPrimarySignIn(context.path ?? ''),
          // Keep the middleware itself intact: Better Auth must merge its response headers,
          // especially the signed challenge cookie, before the redirect hook below runs.
          handler: challenge.handler,
        },
        {
          matcher: (context: Parameters<typeof challenge.matcher>[0]) =>
            isPrimarySignIn(context.path ?? '') && context.request?.method === 'GET',
          handler: createAuthMiddleware((context) => {
            const returned: unknown = context.context.returned;
            if (
              typeof returned !== 'object' ||
              returned === null ||
              !('twoFactorRedirect' in returned) ||
              returned.twoFactorRedirect !== true
            )
              return Promise.resolve();
            const destination = new URL('/login', appUrl);
            destination.searchParams.set('twoFactor', 'required');
            const callback: unknown =
              context.query?.callbackURL ?? context.context.responseHeaders?.get('location');
            if (typeof callback === 'string') {
              const requested = new URL(callback, appUrl);
              if (requested.origin === new URL(appUrl).origin) {
                destination.searchParams.set('redirect', requested.pathname + requested.search);
              }
            }
            throw context.redirect(destination.toString());
          }),
        },
      ],
    },
  };
}
