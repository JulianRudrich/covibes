import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import { configQuery, sessionQuery, type SessionUser } from '@web/features/auth/session';
import {
  notificationSettingsQuery,
  useUpdateNotificationSettings,
} from '@web/features/notifications/queries';
import { authClient } from '@web/lib/auth-client';

type AccountMenuProps = {
  user: SessionUser;
  /** The own avatar; it becomes the button that opens the menu. */
  children: ReactNode;
};

/**
 * The account menu behind the own avatar: who is signed in, the switch for notification mails
 * (spec 22b) and signing out.
 */
export function AccountMenu({ user, children }: AccountMenuProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // Mails about what the person has not seen in the app (spec 22b); a server that cannot send
  // mail offers no switch.
  const canMail = useQuery(configQuery).data?.emailLogin !== false;
  const settings = useQuery({ ...notificationSettingsQuery, enabled: canMail }).data;
  const updateSettings = useUpdateNotificationSettings();

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
        {canMail && settings ? (
          <DropdownMenuCheckboxItem
            checked={settings.email}
            onCheckedChange={(email) => {
              updateSettings.mutate({ email });
            }}
          >
            {t('account.emailNotifications')}
          </DropdownMenuCheckboxItem>
        ) : null}
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut size={14} aria-hidden="true" />
          {t('account.signOut')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
