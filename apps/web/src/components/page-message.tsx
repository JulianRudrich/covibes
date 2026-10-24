import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Logo } from '@web/components/logo';
import { Card } from '@web/components/ui/card';

/**
 * Full-screen centered card for loading, not-found and error states, and for the invitation (spec
 * 36c): the brand above it and the title in the display type of the login.
 */
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
  const { t } = useTranslation();
  return (
    <main className="grid min-h-dvh place-items-center bg-bg-app p-6 text-text">
      <div className="w-full max-w-[440px]">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <Logo />
          <span className="font-display text-[18px] font-bold tracking-[-0.025em]">
            {t('common.wordmark')}
          </span>
        </div>
        <Card className="grid gap-2.5 px-8 py-9 text-center">
          <h1 className="m-0 font-display text-[22px] font-semibold tracking-[-0.02em] text-balance">
            {title}
          </h1>
          {children}
        </Card>
        {below ? <div className="mt-4">{below}</div> : null}
      </div>
    </main>
  );
}
