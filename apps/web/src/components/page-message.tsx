import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Logo } from '@web/components/logo';
import { buttonVariants } from '@web/components/ui/button-variants';
import { Card } from '@web/components/ui/card';
import { cn } from '@web/lib/cn';

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

/** A link that is the action of a message page: a 46 px secondary pill, centered (spec 36d). */
export function PageMessageLink({ to, children }: { to: '/'; children: ReactNode }) {
  return (
    <Link
      to={to}
      className={cn(
        buttonVariants({ variant: 'secondary', size: 'l' }),
        'mt-3 justify-self-center text-text-body no-underline hover:no-underline',
      )}
    >
      {children}
    </Link>
  );
}
