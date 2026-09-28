import type { ReactNode } from 'react';

import { Card } from '@web/components/ui/card';

/** Full-screen centered card for loading, not-found and error states. */
export function PageMessage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg-app p-6 text-text">
      <Card className="grid w-full max-w-[420px] gap-2 p-6 text-center">
        <h1 className="m-0 text-display font-semibold">{title}</h1>
        {children}
      </Card>
    </main>
  );
}
