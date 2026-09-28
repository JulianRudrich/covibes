import { RouterProvider } from '@tanstack/react-router';

import { TooltipProvider } from '@web/components/ui/tooltip';
import type { AppRouter } from '@web/router';

export function App({ router }: { router: AppRouter }) {
  return (
    <TooltipProvider>
      <RouterProvider router={router} />
    </TooltipProvider>
  );
}
