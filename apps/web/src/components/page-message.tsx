import type { ReactNode } from 'react';

import { Card } from '@web/components/ui/card';

/** Full-screen centered card for loading, not-found and error states. */
export function PageMessage({
  title,
  children,
  below,
}: {
  title: string;
  children?: ReactNode;
  /** Something small under the card, e.g. the language switch of a signed-out page. */
  below?: ReactNode;
}) {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg-app p-6 text-text">
      <div className="w-full max-w-[420px]">
        <Card className="grid gap-2 p-6 text-center">
          <h1 className="m-0 text-display font-semibold">{title}</h1>
          {children}
        </Card>
        {below ? <div className="mt-4">{below}</div> : null}
      </div>
    </main>
  );
}
