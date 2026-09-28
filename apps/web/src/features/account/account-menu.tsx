import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import { sessionQuery, type SessionUser } from '@web/features/auth/session';
import { authClient } from '@web/lib/auth-client';

type AccountMenuProps = {
  user: SessionUser;
  /** The own avatar; it becomes the button that opens the menu. */
  children: ReactNode;
};

export function AccountMenu({ user, children }: AccountMenuProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function signOut() {
    await authClient.signOut();
    // Nothing of the previous user may stay in the cache.
    queryClient.clear();
    queryClient.setQueryData(sessionQuery.queryKey, null);
    await navigate({ to: '/login' });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('account.menu')}
        className="cursor-pointer rounded-full border-0 bg-transparent p-0"
      >
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>
          <span className="block font-medium text-text">{user.name}</span>
          <span className="block truncate">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut size={14} aria-hidden="true" />
          {t('account.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
