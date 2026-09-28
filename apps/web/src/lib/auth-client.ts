import { magicLinkClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

// Default base path `/api/auth` on the web app's own origin. Vite forwards it to the server, so
// the session cookie stays first-party and never has to cross origins.
export const authClient = createAuthClient({ plugins: [magicLinkClient()] });
