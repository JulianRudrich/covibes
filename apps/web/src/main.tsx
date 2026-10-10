import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Importing the env module validates it immediately, so a misconfigured build fails at startup.
import '@web/env';
import '@web/i18n';
import '@web/styles/index.css';

import { App } from '@web/app';
import { startLanguage } from '@web/i18n/language';
import { createQueryClient } from '@web/lib/query-client';
import { createAppRouter } from '@web/router';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

startLanguage();

const queryClient = createQueryClient();
const router = createAppRouter(queryClient);

createRoot(rootElement).render(
  <StrictMode>
    <App router={router} queryClient={queryClient} />
  </StrictMode>,
);
