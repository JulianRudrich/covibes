import { Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { IconButton } from '@web/components/ui/icon-button';
import { Tooltip } from '@web/components/ui/tooltip';
import { chooseTheme, useTheme } from '@web/lib/theme';

/**
 * The sun or moon of the top bar (handoff "Top bar"): switches to the other theme on this device.
 * Following the system again is chosen in the account menu.
 */
export function ThemeButton() {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const label = t(theme === 'dark' ? 'theme.toLight' : 'theme.toDark');
  return (
    <Tooltip content={label}>
      <IconButton
        aria-label={label}
        className="size-[34px] text-text-2"
        onClick={() => {
          chooseTheme(theme === 'dark' ? 'light' : 'dark');
        }}
      >
        {theme === 'dark' ? (
          <Sun size={17} strokeWidth={1.9} aria-hidden="true" />
        ) : (
          <Moon size={17} strokeWidth={1.9} aria-hidden="true" />
        )}
      </IconButton>
    </Tooltip>
  );
}
