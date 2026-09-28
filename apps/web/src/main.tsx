import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from '@web/app';
// Importing the env module validates it immediately, so a misconfigured build fails at startup.
import '@web/env';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
