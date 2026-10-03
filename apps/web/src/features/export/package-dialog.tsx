import {
  PACKAGE_TEXT_KINDS,
  PACKAGE_TEXT_MAX_LENGTH,
  type CodingPackageOverview,
  type PackageTextKind,
  type PackageTexts,
} from '@covibes/shared';
import { useQuery } from '@tanstack/react-query';
import { Check, Circle, Download } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import { DialogClose, DialogContent } from '@web/components/ui/dialog';
import { FieldError, Label } from '@web/components/ui/input';
import {
  downloadPackage,
  packageQuery,
  savePackageText,
  useSavePackageText,
} from '@web/features/export/package-queries';
import { cn } from '@web/lib/cn';

const SECTION_TITLE = 'm-0 text-small font-medium text-text-2';

const FIELD =
  'w-full resize-y rounded-md border border-border-strong bg-bg-panel px-3 py-2 text-ui leading-normal text-text transition-colors placeholder:text-text-4 focus-visible:border-ink focus-visible:outline-none read-only:bg-bg-subtle';

/** Where a text of the team stands between the field and the server. */
type Saving = 'idle' | 'saving' | 'saved' | 'failed';

type PackageDialogProps = {
  projectId: string;
  /** Decisions changed since the plan was last written (spec 25c); the package would carry it. */
  outdated: boolean;
};

/**
 * The export dialog of the package for coding agents (spec 27b; derived look): what the package
 * holds and what is still missing, the two texts the plan does not hold, the list of its files and
 * the download. The content of a dialog; the caller opens and closes it.
 */
export function PackageDialog({ projectId, outdated }: PackageDialogProps) {
  const { t } = useTranslation();
  const overview = useQuery(packageQuery(projectId));
  return (
    <DialogContent
      title={t('export.package.title')}
      description={t('export.package.hint')}
      className="w-[min(560px,calc(100vw-32px))]"
    >
      {overview.data ? (
        <PackageBody projectId={projectId} overview={overview.data} outdated={outdated} />
      ) : (
        <>
          {overview.isError ? (
            <FieldError>{t('export.package.loadFailed')}</FieldError>
          ) : (
            <p role="status" className="m-0 text-ui text-text-3">
              {t('common.loading')}
            </p>
          )}
          <div className="mt-4 flex justify-end">
            <DialogClose asChild>
              <Button variant="ghost">{t('common.close')}</Button>
            </DialogClose>
          </div>
        </>
      )}
    </DialogContent>
  );
}

function PackageBody({
  projectId,
  overview,
  outdated,
}: PackageDialogProps & { overview: CodingPackageOverview }) {
  const { t } = useTranslation();
  const ids = useId();
  const save = useSavePackageText(projectId);
  const [drafts, setDrafts] = useState<PackageTexts>(overview.texts);
  const [saving, setSaving] = useState<Record<PackageTextKind, Saving>>({
    code_standards: 'idle',
    ui_direction: 'idle',
  });
  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState(false);
  /** What the server has, so a text is stored once and only when it changed. */
  const stored = useRef<PackageTexts>(overview.texts);
  /** What the fields show, for when the dialog closes with a field never left. */
  const shown = useRef<PackageTexts>(overview.texts);
  /** Stores run one after the other: leaving a field and downloading may ask for the same one. */
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  /** Stores a text if it differs from what the server has; whether it is stored afterwards. */
  function store(kind: PackageTextKind, text: string): Promise<boolean> {
    const content = text.trim();
    const run = queue.current.then(async () => {
      if (content === stored.current[kind]) return true;
      setSaving((state) => ({ ...state, [kind]: 'saving' }));
      try {
        await save.mutateAsync({ kind, content });
        stored.current = { ...stored.current, [kind]: content };
        setSaving((state) => ({ ...state, [kind]: 'saved' }));
        return true;
      } catch {
        setSaving((state) => ({ ...state, [kind]: 'failed' }));
        return false;
      }
    });
    queue.current = run;
    return run;
  }

  // Closing the dialog leaves no field: what it shows is stored then, after what is on its way.
  const { canEdit } = overview;
  useEffect(
    () => () => {
      if (!canEdit) return;
      for (const kind of PACKAGE_TEXT_KINDS) {
        void queue.current.then(() => {
          const content = shown.current[kind].trim();
          if (content === stored.current[kind]) return undefined;
          return savePackageText(projectId, kind, content).catch(() => undefined);
        });
      }
    },
    [projectId, canEdit],
  );

  async function download() {
    setFailed(false);
    setDownloading(true);
    try {
      if (overview.canEdit) {
        // The package holds what the fields show, also when a field was never left.
        const results = await Promise.all(
          PACKAGE_TEXT_KINDS.map((kind) => store(kind, drafts[kind])),
        );
        // The field says that its text is not stored; the package would miss it.
        if (results.includes(false)) return;
      }
      await downloadPackage(projectId);
    } catch {
      setFailed(true);
    } finally {
      setDownloading(false);
    }
  }

  const { decided, open } = overview.decisions;
  const rows: { key: string; done: boolean; text: string }[] = [
    {
      key: 'plan',
      done: overview.hasPlan && !outdated,
      text: !overview.hasPlan
        ? t('export.package.rows.noPlan')
        : outdated
          ? t('export.package.rows.planOutdated')
          : t('export.package.rows.plan'),
    },
    {
      key: 'specs',
      done: overview.tasks > 0,
      text:
        overview.tasks > 0
          ? `${t('export.package.rows.specs', { count: overview.tasks })} · ${t(
              'export.package.rows.milestones',
              { count: overview.milestones },
            )}`
          : t('export.package.rows.noSpecs'),
    },
    {
      key: 'decisions',
      done: decided > 0 && open === 0,
      text:
        decided + open === 0
          ? t('export.package.rows.noDecisions')
          : [
              t('export.package.rows.decisions', { count: decided }),
              ...(open > 0 ? [t('export.package.rows.openDecisions', { count: open })] : []),
            ].join(' · '),
    },
    {
      key: 'diagrams',
      done: overview.diagrams > 0,
      text:
        overview.diagrams > 0
          ? t('export.package.rows.diagrams', { count: overview.diagrams })
          : t('export.package.rows.noDiagrams'),
    },
    ...PACKAGE_TEXT_KINDS.map((kind) => {
      const given = overview.texts[kind] !== '';
      return {
        key: kind,
        done: given,
        text: t(`export.package.rows.${kind}.${given ? 'given' : 'missing'}`),
      };
    }),
  ];

  return (
    <>
      <div className="flex max-h-[min(64vh,600px)] flex-col gap-5 overflow-y-auto pr-1">
        <section aria-labelledby={`${ids}-content`} className="flex flex-col gap-1.5">
          <h3 id={`${ids}-content`} className={SECTION_TITLE}>
            {t('export.package.content')}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {rows.map((row) => (
              <li
                key={row.key}
                data-done={row.done}
                className={cn(
                  'flex items-start gap-2 text-ui leading-snug',
                  row.done ? 'text-text-body' : 'text-text-3',
                )}
              >
                {row.done ? (
                  <Check
                    size={14}
                    strokeWidth={2.5}
                    aria-hidden="true"
                    className="mt-[3px] shrink-0 text-success"
                  />
                ) : (
                  <Circle
                    size={14}
                    strokeWidth={2}
                    aria-hidden="true"
                    className="mt-[3px] shrink-0 text-text-4"
                  />
                )}
                <span>{row.text}</span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby={`${ids}-texts`} className="flex flex-col gap-3">
          <div className="flex flex-col gap-0.5">
            <h3 id={`${ids}-texts`} className={SECTION_TITLE}>
              {t('export.package.texts.title')}
            </h3>
            <p className="m-0 text-small leading-snug text-text-3">
              {t(overview.canEdit ? 'export.package.texts.hint' : 'export.package.texts.readOnly')}
            </p>
          </div>
          {PACKAGE_TEXT_KINDS.map((kind) => (
            <div key={kind} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor={`${ids}-${kind}`}>{t(`export.package.texts.${kind}.label`)}</Label>
                {saving[kind] === 'idle' ? null : (
                  <span
                    role="status"
                    className={cn(
                      'text-meta',
                      saving[kind] === 'failed' ? 'text-danger' : 'text-text-4',
                    )}
                  >
                    {t(`export.package.texts.${saving[kind]}`)}
                  </span>
                )}
              </div>
              <textarea
                id={`${ids}-${kind}`}
                value={drafts[kind]}
                rows={4}
                maxLength={PACKAGE_TEXT_MAX_LENGTH}
                readOnly={!overview.canEdit}
                placeholder={t(
                  overview.canEdit
                    ? `export.package.texts.${kind}.placeholder`
                    : 'export.package.texts.empty',
                )}
                className={FIELD}
                onChange={(event) => {
                  const text = event.target.value;
                  shown.current = { ...shown.current, [kind]: text };
                  setDrafts((state) => ({ ...state, [kind]: text }));
                  setSaving((state) => ({ ...state, [kind]: 'idle' }));
                }}
                onBlur={(event) => {
                  if (overview.canEdit) void store(kind, event.target.value);
                }}
              />
            </div>
          ))}
        </section>

        {overview.files.length > 0 ? (
          <details className="group">
            <summary className="cursor-pointer text-small font-medium text-text-2 select-none hover:text-text">
              {t('export.package.files', { count: overview.files.length })}
            </summary>
            <ul className="mt-1.5 mb-0 flex list-none flex-col gap-0.5 rounded-md bg-bg-subtle px-3 py-2 font-mono text-meta text-text-2">
              {overview.files.map((path) => (
                <li key={path} className="pl-3 -indent-3 [overflow-wrap:anywhere]">
                  {path}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>

      {failed ? <FieldError className="mt-3">{t('export.failed')}</FieldError> : null}

      <div className="mt-4 flex items-center justify-end gap-2">
        <DialogClose asChild>
          <Button variant="ghost">{t('common.close')}</Button>
        </DialogClose>
        <Button
          variant="primary"
          disabled={!overview.hasPlan || downloading}
          onClick={() => {
            void download();
          }}
        >
          <Download size={14} strokeWidth={2} aria-hidden="true" />
          {t('export.package.download')}
        </Button>
      </div>
    </>
  );
}
