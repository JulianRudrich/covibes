import { passkeyClient } from '@better-auth/passkey/client';
import {
  emailOTPClient,
  inferAdditionalFields,
  magicLinkClient,
  twoFactorClient,
} from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// Default base path `/api/auth` on the web app's own origin. Vite forwards it to the server, so
// the session cookie stays first-party and never has to cross origins.
// The account also holds its language (spec 32a), which its owner reads and sets.
export const authClient = createAuthClient({
  plugins: [
    magicLinkClient(),
    emailOTPClient(),
    passkeyClient(),
    twoFactorClient(),
    inferAdditionalFields({ user: { locale: { type: 'string', required: false } } }),
  ],
});
