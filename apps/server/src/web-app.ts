import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { serveStatic } from '@hono/node-server/serve-static';
import type { Context, Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

/** Security headers for every response in production (spec 02b). */
export function securityHeaders(appUrl: string) {
  const url = new URL(appUrl);
  const https = url.protocol === 'https:';
  return secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // React Flow and Radix position elements with inline styles.
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'"],
      // Collaboration runs over a WebSocket on the same host.
      connectSrc: ["'self'", `${https ? 'wss' : 'ws'}://${url.host}`],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
    strictTransportSecurity: https ? 'max-age=31536000; includeSubDomains' : false,
    referrerPolicy: 'strict-origin-when-cross-origin',
    xFrameOptions: 'DENY',
  });
}

/**
 * Serves the built web app from `dir`: existing files as they are, every other page as
 * `index.html`, so the app's own router takes over after a reload on e.g. `/p/…`.
 */
export function serveWebApp(app: Hono, dir: string, appUrl: string) {
  const root = resolve(dir);
  // Preview metadata is generic and bound to configured public origin, never a request Host
  // header, private project, invitation token or share-token URL.
  const imageUrl = new URL('/share-preview.png', new URL(appUrl).origin).href;
  const indexHtml = readFileSync(join(root, 'index.html'), 'utf8').replace(
    /(<meta (?:property="og:image"|name="twitter:image") content=")\/share-preview\.png(")/g,
    `$1${imageUrl}$2`,
  );
  const appPage = (c: Context) => {
    // Always ask for a fresh index.html, so a new version reaches everyone right away.
    c.header('Cache-Control', 'no-cache');
    return c.html(indexHtml);
  };

  // Vite puts a content hash into every file name under assets/, so these never change.
  app.use('/assets/*', async (c, next) => {
    await next();
    if (c.res.status === 200) c.header('Cache-Control', 'public, max-age=31536000, immutable');
  });
  app.use('/assets/*', serveStatic({ root }));
  app.get('/', appPage);
  app.get('/index.html', appPage);
  app.use('*', serveStatic({ root }));
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.notFound() : appPage(c)));
}
