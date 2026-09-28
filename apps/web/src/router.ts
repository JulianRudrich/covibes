import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import { z } from 'zod';

import { LoginPage } from '@web/features/auth/login-page';
import { safeRedirectPath } from '@web/features/auth/redirect-path';
import { sessionQuery } from '@web/features/auth/session';
import { DevMailsPage } from '@web/features/dev/dev-mails-page';
import { ErrorPage, NotFoundPage } from '@web/features/errors/error-pages';
import { ProjectListPage } from '@web/features/projects/project-list-page';
import { WorkspacePage } from '@web/features/workspace/workspace-page';

export type RouterContext = { queryClient: QueryClient };

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  notFoundComponent: NotFoundPage,
  errorComponent: ErrorPage,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  validateSearch: z.object({
    redirect: z.string().optional().catch(undefined),
    error: z.string().optional().catch(undefined),
  }),
  beforeLoad: async ({ context, search }) => {
    const user = await context.queryClient.query(sessionQuery);
    if (user)
      redirect({ href: safeRedirectPath(search.redirect) ?? '/', replace: true, throw: true });
  },
  component: LoginPage,
});

/** Everything below needs a session; without one the user signs in and comes back. */
const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: '_authed',
  beforeLoad: async ({ context, location }) => {
    const user = await context.queryClient.query(sessionQuery);
    if (!user) {
      redirect({ to: '/login', search: { redirect: location.href }, replace: true, throw: true });
    }
  },
  component: Outlet,
});

const projectListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  component: ProjectListPage,
});

const projectRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/p/$projectId',
  component: WorkspacePage,
});

// The development mailbox is not part of production builds.
const devMailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/mails',
  component: DevMailsPage,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  authedRoute.addChildren([projectListRoute, projectRoute]),
  ...(import.meta.env.DEV ? [devMailsRoute] : []),
]);

/** Creates the app router. Tests pass a memory history; the browser uses the default one. */
export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({ routeTree, history, context: { queryClient } });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
