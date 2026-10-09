import { packageSpecRefs } from './coding-package';
import { markdownLine } from './export-texts';
import type { GitRepository } from './git';
import type { GitActionDraft } from './git-requests';
import { codingPackageTexts } from './package-texts';
import type { PlanLanguage } from './plan';
import type { Roadmap } from './plan-roadmap';

// Issues from the plan (spec 29b): one issue per task, grouped by the plan's milestones and linked
// to the task's feature spec in the repository. Built from the plan alone, without a model.

/** What marks an issue as the one of an action, in a comment at the end of its description. */
export const GIT_ISSUE_MARK = 'covibes-action';

/** The mark of an action, as its issue carries it: it finds the issue again after a lost answer. */
export function gitIssueMark(actionId: string): string {
  return `${GIT_ISSUE_MARK}:${actionId}`;
}

/** The longest title an issue or a milestone takes. */
const TITLE_MAX = 255;

type IssueTexts = {
  goal: string;
  spec: string;
  /** The note every issue ends with. */
  via: (projectName: string) => string;
};

const TEXTS: Readonly<Record<PlanLanguage, IssueTexts>> = {
  de: {
    goal: 'Ziel',
    spec: 'Feature-Spec',
    via: (projectName) =>
      `Angelegt via Covibes aus dem Projektplan von „${markdownLine(projectName)}“.`,
  },
  en: {
    goal: 'Goal',
    spec: 'Feature spec',
    via: (projectName) =>
      `Created via Covibes from the project plan of "${markdownLine(projectName)}".`,
  },
};

/** A text as one line of at most `max` characters, for a title. */
function short(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** The address of a file on the default branch, as the repository's pages show it. */
function fileUrl(repository: Pick<GitRepository, 'url' | 'defaultBranch'>, path: string): string {
  const ref = (repository.defaultBranch ?? 'HEAD').split('/').map(encodeURIComponent).join('/');
  return `${repository.url.replace(/\/+$/, '')}/-/blob/${ref}/${path}`;
}

export type IssueActionsInput = {
  projectName: string;
  /** The project's language, in which the issues are written. */
  language: PlanLanguage;
  /** The plan's roadmap, with who took which task. */
  roadmap: Roadmap;
  /** The tasks that get an issue, by the id they carry in the plan. */
  taskIds: ReadonlySet<string>;
  /** The repository the issues go to: its pages and its default branch give the spec's link. */
  repository: Pick<GitRepository, 'url' | 'defaultBranch'>;
};

/**
 * The actions that create the issues of the chosen tasks, in the order of the plan: per milestone
 * with a chosen task first the milestone, then its issues. An issue names its task, its
 * milestone with the goal, who took it and where its feature spec is, and ends with "via
 * Covibes". A task without an id, or one that is not chosen, gets none.
 */
export function buildIssueActions({
  projectName,
  language,
  roadmap,
  taskIds,
  repository,
}: IssueActionsInput): GitActionDraft[] {
  const texts = TEXTS[language];
  const packageTexts = codingPackageTexts(language);
  const specs = new Map(
    packageSpecRefs(roadmap, language).flatMap((spec) =>
      spec.taskId ? [[spec.taskId, spec] as const] : [],
    ),
  );
  const actions: GitActionDraft[] = [];
  for (const milestone of roadmap.milestones) {
    const chosen = milestone.tasks.filter((task) => task.id !== null && taskIds.has(task.id));
    if (chosen.length === 0) continue;
    const name = short(packageTexts.milestone(milestone.number, milestone.title), TITLE_MAX);
    actions.push({
      kind: 'milestone',
      payload: { title: name, description: milestone.goal.slice(0, 2000) },
    });
    for (const task of chosen) {
      if (task.id === null) continue;
      const spec = specs.get(task.id);
      const lines = [
        `**${packageTexts.milestoneHeading}:** ${markdownLine(name)}`,
        milestone.goal.trim() && `**${texts.goal}:** ${markdownLine(milestone.goal)}`,
        task.assignee?.name && `**${packageTexts.assignee}:** ${markdownLine(task.assignee.name)}`,
        spec && `**${texts.spec}:** [\`${spec.path}\`](${fileUrl(repository, spec.path)})`,
      ].filter((line): line is string => Boolean(line));
      actions.push({
        kind: 'issue',
        payload: {
          title: short(task.text, TITLE_MAX),
          description: [
            markdownLine(task.text),
            // Two spaces at the end of a line break it without a new paragraph.
            lines.join('  \n'),
            '---',
            `*${texts.via(projectName)}*`,
          ].join('\n\n'),
          milestone: name,
          taskId: task.id,
        },
      });
    }
  }
  return actions;
}
