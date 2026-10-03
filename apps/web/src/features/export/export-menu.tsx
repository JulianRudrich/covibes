import { Download } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@web/components/ui/dropdown-menu';
import { cn } from '@web/lib/cn';

/** A format to export in: what the menu calls it, and what makes and downloads the file. */
export type ExportOption = {
  key: string;
  label: string;
  run: () => Promise<void> | void;
  /** A line above it sets it apart from the formats before it. */
  separated?: boolean;
};

/**
 * "Exportieren" (spec 27a; derived looks): a button with a download icon that opens the formats.
 * Choosing one downloads the file at once; while it is made, the button rests. `className` gives
 * the button the look of the toolbar it sits in.
 */
export function ExportMenu({
  options,
  onFailed,
  className,
}: {
  options: readonly ExportOption[];
  /** An export gave no file, e.g. the browser could not draw the board. */
  onFailed: () => void;
  className: string;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  async function run(option: ExportOption) {
    setBusy(true);
    try {
      await option.run();
    } catch {
      onFailed();
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t('export.label')}
        title={t('export.label')}
        disabled={busy}
        className={cn(
          'cursor-pointer place-items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-wait disabled:opacity-60',
          className,
        )}
      >
        <Download
          size={15}
          strokeWidth={2}
          aria-hidden="true"
          className={cn(busy && 'animate-pulse')}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[220px]">
        {options.map((option) => (
          <Fragment key={option.key}>
            {option.separated ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              onSelect={() => {
                void run(option);
              }}
            >
              {option.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
