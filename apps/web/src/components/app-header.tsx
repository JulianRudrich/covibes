import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Logo } from '@web/components/logo';

/** Top bar of pages outside the workspace: brand on the left, `children` on the right. */
export function AppHeader({ children }: { children?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <header className="flex h-[52px] items-center justify-between px-4">
      <Link
        to="/"
        className="flex items-center gap-2.5 text-text no-underline hover:text-text"
        aria-label={t('projects.title')}
      >
        <Logo />
        <span className="font-display text-[18px] font-bold tracking-[-0.025em]">
          {t('common.wordmark')}
        </span>
      </Link>
      <div className="flex items-center gap-2.5">{children}</div>
    </header>
  );
}
