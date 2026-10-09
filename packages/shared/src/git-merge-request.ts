import { PACKAGE_PATHS, type PackageFile } from './coding-package';
import { markdownLine } from './export-texts';
import { gitViaNote } from './git-issues';
import type { GitFile, GitMergeRequestActionDraft } from './git-requests';
import type { PlanLanguage } from './plan';

// The plan package as a merge request (spec 29c): one commit of the package's files on a branch
// of its own, and the merge request for that branch. Built from the package alone, without a
// model.

/**
 * Files that are only added when the repository does not hold them: the progress tracker belongs
 * to the coding agent after the handover.
 */
export const CREATE_ONLY_PATHS: readonly string[] = [PACKAGE_PATHS.tracker];

const DIAGRAMS_DIR = 'docs/diagrams/';

/** A feature spec as the package names them, e.g. "context/feature-specs/01-02-login.md". */
export const STALE_SPEC_PATTERN = /^context\/feature-specs\/\d{2}-\d{2}-[^/]+\.md$/;

/** How much files weigh together as UTF-8. */
export function packageBytes(files: readonly Pick<PackageFile, 'content'>[]): number {
  const encoder = new TextEncoder();
  return files.reduce((sum, file) => sum + encoder.encode(file.content).length, 0);
}

/** The branch of a request: the day it was made and a mark that makes the name its own. */
export function mergeRequestBranch(date: Date, mark: string): string {
  return `covibes/plan-${date.toISOString().slice(0, 10)}-${mark}`;
}

type Texts = {
  /** The first line of the commit and the title of the merge request. */
  title: string;
  /** What the list of actions calls the commit. */
  commit: (branch: string, files: number) => string;
  intro: (projectName: string) => string;
  entry: string;
  context: string;
  specs: (count: number) => string;
  diagrams: (count: number) => string;
  changes: string;
  stale: string;
};

const TEXTS: Readonly<Record<PlanLanguage, Texts>> = {
  de: {
    title: 'Projektplan, Feature-Specs und Diagramme aus Covibes',
    commit: (branch, files) =>
      `Plan-Paket auf dem Branch ${branch} (${String(files)} ${files === 1 ? 'Datei' : 'Dateien'})`,
    intro: (projectName) =>
      `Das Plan-Paket von „${markdownLine(projectName)}“, wie das Team es in Covibes geplant hat:`,
    entry: '`CLAUDE.md` und `AGENTS.md`: der Einstieg für Coding-Agents',
    context:
      '`context/`: Projektübersicht, Architektur, Entscheidungen, Code-Standards, UI-Richtung, Projektplan und Fortschritt',
    specs: (count) =>
      `\`context/feature-specs/\`: ${String(count)} ${count === 1 ? 'Feature-Spec' : 'Feature-Specs'}`,
    diagrams: (count) =>
      `\`docs/diagrams/\`: ${String(count)} ${count === 1 ? 'Datei' : 'Dateien'} mit Diagrammen`,
    changes:
      'Dateien, die es im Repository schon gab, erscheinen hier als Änderung. `context/progress-tracker.md` wird nur angelegt, wenn sie fehlt.',
    stale:
      '**Nicht mehr im Paket** (Feature-Specs aus einem früheren Stand; bei Bedarf von Hand entfernen):',
  },
  en: {
    title: 'Project plan, feature specs and diagrams from Covibes',
    commit: (branch, files) =>
      `Plan package on the branch ${branch} (${String(files)} ${files === 1 ? 'file' : 'files'})`,
    intro: (projectName) =>
      `The plan package of "${markdownLine(projectName)}", as the team planned it in Covibes:`,
    entry: '`CLAUDE.md` and `AGENTS.md`: where coding agents start',
    context:
      '`context/`: project overview, architecture, decisions, code standards, UI direction, project plan and progress',
    specs: (count) =>
      `\`context/feature-specs/\`: ${String(count)} ${count === 1 ? 'feature spec' : 'feature specs'}`,
    diagrams: (count) =>
      `\`docs/diagrams/\`: ${String(count)} ${count === 1 ? 'file' : 'files'} of diagrams`,
    changes:
      'Files the repository held already appear as changes here. `context/progress-tracker.md` is only added when it is missing.',
    stale:
      '**No longer in the package** (feature specs of an earlier state; remove them by hand if needed):',
  },
};

/** The files of a package as a commit writes them: the progress tracker only when missing. */
export function gitFilesOf(files: readonly PackageFile[]): GitFile[] {
  return files.map((file) => ({
    path: file.path,
    content: file.content,
    mode: CREATE_ONLY_PATHS.includes(file.path) ? 'create' : 'write',
  }));
}

export type MergeRequestActionsInput = {
  projectName: string;
  /** The project's language, in which commit and merge request are worded. */
  language: PlanLanguage;
  /** The files of the package (`buildCodingPackage`). */
  files: readonly PackageFile[];
  /** The branch of the commit (`mergeRequestBranch`). */
  branch: string;
  /** The branch the merge request goes into: the repository's default branch. */
  targetBranch: string;
  /** Feature specs the repository holds that the package no longer has. */
  stale?: readonly string[];
};

/**
 * The two actions that bring a package into a repository (spec 29c): the commit of its files on
 * a branch started from the target branch, and the merge request for that branch. The progress
 * tracker is only added when it is missing; every other file is added or changed. Without files
 * there are no actions.
 */
export function buildMergeRequestActions({
  projectName,
  language,
  files,
  branch,
  targetBranch,
  stale = [],
}: MergeRequestActionsInput): GitMergeRequestActionDraft[] {
  if (files.length === 0) return [];
  const texts = TEXTS[language];
  const via = gitViaNote(language, projectName);
  const specs = files.filter((file) => STALE_SPEC_PATTERN.test(file.path)).length;
  const diagrams = files.filter((file) => file.path.startsWith(DIAGRAMS_DIR)).length;
  const holds = [
    texts.entry,
    texts.context,
    specs > 0 && texts.specs(specs),
    diagrams > 0 && texts.diagrams(diagrams),
  ].filter((line): line is string => Boolean(line));

  return [
    {
      kind: 'commit',
      payload: {
        title: texts.commit(branch, files.length),
        branch,
        startBranch: targetBranch,
        message: `${texts.title}\n\n${via}`,
        files: gitFilesOf(files),
      },
    },
    {
      kind: 'merge_request',
      payload: {
        title: texts.title,
        description: [
          texts.intro(projectName),
          holds.map((line) => `- ${line}`).join('\n'),
          texts.changes,
          stale.length > 0 && `${texts.stale}\n${stale.map((path) => `- \`${path}\``).join('\n')}`,
          '---',
          `*${via}*`,
        ]
          .filter((block): block is string => Boolean(block))
          .join('\n\n')
          .slice(0, 20_000),
        sourceBranch: branch,
        targetBranch,
      },
    },
  ];
}
