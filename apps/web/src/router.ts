import { GIT_RETURNS } from '@covibes/shared';
import type { QueryClient } from '@tanstack/react-query';
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  lazyRouteComponent,
  redirect,
  type RouterHistory,
} from '@tanstack/react-router';
import { z } from 'zod';

import { RouteLoading } from '@web/components/route-loading';
import { safeRedirectPath } from '@web/features/auth/redirect-path';
import { sessionQuery } from '@web/features/auth/session';
import { ErrorPage, NotFoundPage } from '@web/features/errors/error-pages';
import { WorkspaceSettingsPage } from '@web/features/workspaces/workspace-settings-page';
import { WorkspaceInvitePage } from '@web/features/workspaces/workspace-invite-page';

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
    twoFactor: z.enum(['required']).optional().catch(undefined),
  }),
  beforeLoad: async ({ context, search }) => {
    const user = await context.queryClient.query(sessionQuery);
    if (user)
      redirect({ href: safeRedirectPath(search.redirect) ?? '/', replace: true, throw: true });
  },
  component: lazyRouteComponent(() => import('@web/features/auth/login-page'), 'LoginPage'),
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

const accountRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/account',
  component: lazyRouteComponent(() => import('@web/features/account/account-page'), 'AccountPage'),
});

const workspaceSettingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/workspaces/$workspaceId',
  component: WorkspaceSettingsPage,
});

const workspaceInviteRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/workspace-invite/$token',
  component: WorkspaceInvitePage,
});

const projectListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  // `gitAccount` says how the way back from GitLab ended (spec 29a); the dialog "GitLab-Konto"
  // of the account menu opens with it once.
  validateSearch: z.object({
    gitAccount: z.enum(GIT_RETURNS).optional().catch(undefined),
    workspace: z.uuid().optional().catch(undefined),
  }),
  component: lazyRouteComponent(
    () => import('@web/features/projects/project-list-page'),
    'ProjectListPage',
  ),
});

const projectRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/p/$projectId',
  // The open board (spec 11); without one, or with one that does not exist, the main canvas.
  // `view=plan` shows the project plan in its place (spec 25a). `focus` names an element of the
  // board to bring into view once, e.g. the roadmap (spec 26a). `git` says how the way back from
  // GitLab ended (spec 28a); the dialog "Repository" opens with it once, and with `gitAccount`
  // the dialog "GitLab-Konto" of the account menu (spec 29a).
  validateSearch: z.object({
    board: z.string().optional().catch(undefined),
    view: z.enum(['plan']).optional().catch(undefined),
    focus: z.string().optional().catch(undefined),
    task: z.uuid().optional().catch(undefined),
    git: z.enum(GIT_RETURNS).optional().catch(undefined),
    gitAccount: z.enum(GIT_RETURNS).optional().catch(undefined),
  }),
  component: lazyRouteComponent(
    () => import('@web/features/workspace/workspace-page'),
    'WorkspacePage',
  ),
});

/** An invitation link (spec 21a); whoever opens it signs in first and comes back here. */
const inviteRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/invite/$token',
  component: lazyRouteComponent(() => import('@web/features/share/invite-page'), 'InvitePage'),
});

/** A read-only link (spec 21b): open to everyone who has it, without a session. */
const shareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/share/$token',
  component: lazyRouteComponent(
    () => import('@web/features/share/share-view-page'),
    'ShareViewPage',
  ),
});

// The development mailbox is not part of production builds.
const devMailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/dev/mails',
  component: lazyRouteComponent(() => import('@web/features/dev/dev-mails-page'), 'DevMailsPage'),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  shareRoute,
  authedRoute.addChildren([
    projectListRoute,
    projectRoute,
    inviteRoute,
    accountRoute,
    workspaceSettingsRoute,
    workspaceInviteRoute,
  ]),
  ...(import.meta.env.DEV ? [devMailsRoute] : []),
]);

/** Creates the app router. Tests pass a memory history; the browser uses the default one. */
export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    context: { queryClient },
    defaultPendingComponent: RouteLoading,
    defaultPendingMs: 150,
    defaultPendingMinMs: 200,
  });
}

export type AppRouter = ReturnType<typeof createAppRouter>;

declare module '@tanstack/react-router' {
  interface Register {
    router: AppRouter;
  }
}
