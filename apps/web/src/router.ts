import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';

import { WorkspacePage } from '@web/features/workspace/workspace-page';

const rootRoute = createRootRoute({ component: Outlet });

// Until the project list exists (spec 04), the start page opens the demo project.
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    redirect({ to: '/p/$projectId', params: { projectId: 'demo' }, replace: true, throw: true });
  },
});

const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/p/$projectId',
  component: WorkspacePage,
});

const routeTree = rootRoute.addChildren([indexRoute, projectRoute]);

/** Creates the app router. Tests pass a memory history; the browser uses the default one. */
export function createAppRouter(history?: RouterHistory) {
  return createRouter({ routeTree, history });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
