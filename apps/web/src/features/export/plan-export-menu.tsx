import {
  exportFileName,
  exportTexts,
  planExportMarkdown,
  type PlanLanguage,
  type PlanNode,
} from '@covibes/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog } from '@web/components/ui/dialog';
import { downloadBlob, downloadText } from '@web/features/export/download';
import { ExportMenu, type ExportOption } from '@web/features/export/export-menu';
import { PackageDialog } from '@web/features/export/package-dialog';
import { planPdf } from '@web/features/export/plan-pdf';

/** A design token as the theme defines it, e.g. the color of text. */
function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * "Exportieren" in the plan's toolbar: the plan as it stands as Markdown or as PDF, named after
 * the project (spec 27a; a task someone took names them), and the package for coding agents,
 * which opens its dialog (spec 27b).
 */
export function PlanExportMenu({
  projectId,
  projectName,
  language,
  nodes,
  assignees,
  outdated,
  onFailed,
}: {
  projectId: string;
  projectName: string;
  /** The project's language, in which an export writes what it adds. */
  language: PlanLanguage;
  /** The plan as it stands. */
  nodes: readonly PlanNode[];
  /** Who took which task, by the id of the task: the name to print. */
  assignees: ReadonlyMap<string, string>;
  /** Decisions changed since the plan was last written (spec 25c); the package says so. */
  outdated: boolean;
  onFailed: () => void;
}) {
  const { t } = useTranslation();
  const [packageOpen, setPackageOpen] = useState(false);
  const plan = { projectName, nodes, assignees, language };
  const fileName = exportFileName(projectName, exportTexts(language).plan);
  const options: ExportOption[] = [
    {
      key: 'markdown',
      label: t('export.markdown'),
      run: () => {
        downloadText(planExportMarkdown(plan), `${fileName}.md`);
      },
    },
    {
      key: 'pdf',
      label: t('export.pdf'),
      run: async () => {
        const pdf = await planPdf({
          ...plan,
          date: new Intl.DateTimeFormat(language, { dateStyle: 'long' }).format(new Date()),
          colors: { text: token('--color-text'), muted: token('--color-text-3') },
        });
        downloadBlob(pdf, `${fileName}.pdf`);
      },
    },
    {
      key: 'package',
      label: t('export.package.menu'),
      separated: true,
      run: () => {
        setPackageOpen(true);
      },
    },
  ];
  return (
    <>
      <ExportMenu
        options={options}
        onFailed={onFailed}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-btn-s text-text-2b transition-colors hover:bg-bg-subtle hover:text-text"
      />
      <Dialog open={packageOpen} onOpenChange={setPackageOpen}>
        {/* Mounted only while open: the dialog loads what the package holds right then. */}
        {packageOpen ? <PackageDialog projectId={projectId} outdated={outdated} /> : null}
      </Dialog>
    </>
  );
}
