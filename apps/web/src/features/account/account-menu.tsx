import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { GitBranch, LogOut } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog } from '@web/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import { configQuery, sessionQuery, type SessionUser } from '@web/features/auth/session';
import { GitAccountDialog } from '@web/features/git/git-account-dialog';
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
 * (spec 22b), the own GitLab account (spec 29a) and signing out.
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
  // The dialog "GitLab-Konto" (spec 29a). Someone who comes back from GitLab lands in it again:
  // the address says how the way back ended, on every page the menu is on.
  const { gitAccount: gitReturned } = useSearch({ strict: false });
  const { projectId } = useParams({ strict: false });
  const [gitOpen, setGitOpen] = useState(gitReturned !== undefined);

  async function signOut() {
    await authClient.signOut();
    // Nothing of the previous user may stay in the cache.
    queryClient.clear();
    queryClient.setQueryData(sessionQuery.queryKey, null);
    await navigate({ to: '/login' });
  }

  return (
    <>
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
          <DropdownMenuItem
            onSelect={() => {
              setGitOpen(true);
            }}
          >
            <GitBranch size={14} aria-hidden="true" />
            {t('git.account.menu')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void signOut()}>
            <LogOut size={14} aria-hidden="true" />
            {t('account.signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={gitOpen}
        onOpenChange={(open) => {
          setGitOpen(open);
          // How the way back ended was said once; then the address is clean again.
          if (!open && gitReturned !== undefined) {
            void navigate({
              to: '.',
              search: (previous) => ({ ...previous, gitAccount: undefined }),
              replace: true,
            });
          }
        }}
      >
        {gitOpen ? <GitAccountDialog projectId={projectId} returned={gitReturned} /> : null}
      </Dialog>
    </>
  );
}
