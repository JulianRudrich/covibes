import { z } from 'zod';

import { boardToMermaid } from './canvas/mermaid';
import { isRoadmap, type CanvasEdge, type CanvasNode } from './canvas/model';
import type { Decision } from './decisions';
import { exportTexts, fileSlug, markdownLine } from './export-texts';
import { codingPackageTexts, type CodingPackageTexts } from './package-texts';
import {
  PLAN_SECTION_ATTRIBUTE,
  planSectionTitle,
  type PlanLanguage,
  type PlanNode,
  type PlanSection,
  type PlanState,
} from './plan';
import { planSectionsOf } from './plan-doc';
import { planExportMarkdown } from './plan-export';
import { planNodesToMarkdown } from './plan-markdown';
import { readRoadmap, type Roadmap, type RoadmapMilestone } from './plan-roadmap';

// The package for coding agents (spec 27b): what a project holds as the files a coding agent
// builds from. Everything here is derived, without a model: the plan gives the context and a
// short spec per task, the decisions and the boards come as they are, and the team's two texts
// (code standards, UI direction) fill what the plan does not say.

/** The texts a team gives for the package, which the plan does not hold. */
export const PACKAGE_TEXT_KINDS = ['code_standards', 'ui_direction'] as const;
export type PackageTextKind = (typeof PACKAGE_TEXT_KINDS)[number];
export const packageTextKindSchema = z.enum(PACKAGE_TEXT_KINDS);

/** Same limit as the check constraint on `package_texts.content` (packages/db/migrations). */
export const PACKAGE_TEXT_MAX_LENGTH = 8000;

/** `PUT /api/projects/:projectId/package/texts/:kind`; an empty text removes it. */
export const packageTextInputSchema = z
  .object({ content: z.string().trim().max(PACKAGE_TEXT_MAX_LENGTH) })
  .strict();
export type PackageTextInput = z.infer<typeof packageTextInputSchema>;

/** The team's texts by their kind; empty where the team gave none. */
export type PackageTexts = Record<PackageTextKind, string>;

/** Feature specs a package holds at most; a plan with more tasks names the rest only in the plan. */
export const MAX_PACKAGE_SPECS = 500;

export type PackageFile = { path: string; content: string };

export type CodingPackageInput = {
  projectName: string;
  /** The project's language, in which the package is written. */
  language: PlanLanguage;
  /** The day the package is made. */
  date: Date;
  /** The time zone the days are written in; the one of the machine if not given. */
  timeZone?: string;
  /** The plan as nodes, in the order of the document. */
  plan: readonly PlanNode[];
  /** Who took which task, by the id of the task: the name to print. */
  assignees?: ReadonlyMap<string, string>;
  decisions: readonly Pick<
    Decision,
    | 'topic'
    | 'status'
    | 'value'
    | 'reasoning'
    | 'alternatives'
    | 'decidedBy'
    | 'decidedAt'
    | 'reopenReason'
  >[];
  /** The project's criteria, as the team worded them. */
  criteria: readonly string[];
  /** The boards of the project in their order, the main canvas first. */
  boards: readonly { title: string; nodes: readonly CanvasNode[]; edges: readonly CanvasEdge[] }[];
  texts: PackageTexts;
};

/** What a package holds, for the export dialog. */
export type CodingPackageSummary = {
  /** The plan holds text below its headings; without it there is no package. */
  hasPlan: boolean;
  milestones: number;
  /** The tasks of the plan, each with a feature spec. */
  tasks: number;
  decisions: { decided: number; open: number };
  /** The boards with content, each with a file of diagrams. */
  diagrams: number;
  /** The paths of the files, in the order of the package; empty without a plan. */
  files: string[];
};

/**
 * The moderator's suggestion for one of the team's texts (spec 27c): it is being written, it
 * waits to be taken over or dismissed, or its run gave nothing. `failure` reads like the plan's:
 * `quota` when the provider's quota was used up (with the time it is free again, if known).
 */
export type PackageSuggestion =
  | { status: 'running' }
  | { status: 'ready'; content: string }
  | { status: 'failed'; failure: NonNullable<PlanState['failure']> };

/** `POST /api/projects/:projectId/package/texts/:kind/suggestion/accept`: the text taken over. */
export type AcceptedPackageSuggestion = { content: string };

/** `GET /api/projects/:projectId/package`. */
export type CodingPackageOverview = CodingPackageSummary & {
  language: PlanLanguage;
  texts: PackageTexts;
  /** What the moderator suggests for each text; null where nobody asked. */
  suggestions: Record<PackageTextKind, PackageSuggestion | null>;
  /** The person may write the texts: owners and editors. */
  canEdit: boolean;
};

/** The paths of the files that are always there. */
export const PACKAGE_PATHS = {
  claude: 'CLAUDE.md',
  agents: 'AGENTS.md',
  overview: 'context/project-overview.md',
  architecture: 'context/architecture.md',
  decisions: 'context/decisions.md',
  codeStandards: 'context/code-standards.md',
  ui: 'context/ui-context.md',
  plan: 'context/project-plan.md',
  tracker: 'context/progress-tracker.md',
  specs: 'context/feature-specs/00-overview.md',
} as const;

const SPECS_DIR = 'context/feature-specs';
const DIAGRAMS_DIR = 'docs/diagrams';

/** A file as text: its blocks with an empty line between them and one line break at the end. */
function file(path: string, blocks: readonly (string | false | null | undefined)[]): PackageFile {
  const text = blocks.filter((block): block is string => Boolean(block)).join('\n\n');
  return { path, content: `${text}\n` };
}

function hasText(node: PlanNode): boolean {
  return (node.text ?? '').trim() !== '' || (node.content ?? []).some(hasText);
}

/** Whether the plan holds text below its headings: the template alone is no plan. */
function planHasContent(plan: readonly PlanNode[]): boolean {
  return plan.some(
    (node) =>
      !(node.type === 'heading' && node.attrs?.[PLAN_SECTION_ATTRIBUTE] !== undefined) &&
      hasText(node),
  );
}

function two(number: number): string {
  return String(number).padStart(2, '0');
}

/** A text as one line of at most `max` characters, for a title. */
function short(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

/** A feature spec is named by at most this many characters of its task. */
const SPEC_NAME_MAX = 48;

/** A task as a part of a file name: a task is a sentence, so the name ends with a whole word. */
function specSlug(text: string): string {
  const slug = fileSlug(text);
  if (slug.length <= SPEC_NAME_MAX || slug[SPEC_NAME_MAX] === '-') {
    return slug.slice(0, SPEC_NAME_MAX);
  }
  const cut = slug.slice(0, SPEC_NAME_MAX);
  const end = cut.lastIndexOf('-');
  // One very long word is cut where the name ends.
  return end >= SPEC_NAME_MAX / 2 ? cut.slice(0, end) : cut;
}

type Spec = {
  /** "01-02": the milestone and the task's place in it. */
  number: string;
  /** The file's name in `context/feature-specs/`. */
  name: string;
  title: string;
  text: string;
  assignee: string | null;
  milestone: RoadmapMilestone;
};

/** The feature specs of a roadmap: one per task, numbered by milestone. */
function specsOf(
  roadmap: Roadmap,
  assignees: ReadonlyMap<string, string> | undefined,
  texts: CodingPackageTexts,
): Spec[] {
  const specs: Spec[] = [];
  for (const milestone of roadmap.milestones) {
    for (const [index, task] of milestone.tasks.entries()) {
      if (specs.length >= MAX_PACKAGE_SPECS) return specs;
      const number = `${two(milestone.number)}-${two(index + 1)}`;
      specs.push({
        number,
        name: `${number}-${specSlug(task.text) || texts.taskFile}.md`,
        title: short(task.text, 80),
        text: task.text.replace(/\s+/g, ' ').trim(),
        assignee: (task.id ? assignees?.get(task.id) : undefined) ?? null,
        milestone,
      });
    }
  }
  return specs;
}

type Diagram = { title: string; path: string; content: string };

/** The boards with content as files of diagrams, each named after its board. */
function diagramsOf(
  { boards, language }: Pick<CodingPackageInput, 'boards' | 'language'>,
  roadmap: Roadmap,
  texts: CodingPackageTexts,
): Diagram[] {
  const taken = new Set<string>();
  const diagrams: Diagram[] = [];
  for (const board of boards) {
    const showsRoadmap = board.nodes.some(isRoadmap) && roadmap.milestones.length > 0;
    const hasContent = board.nodes.some((node) => node.type === 'block' || node.type === 'sticky');
    if (!hasContent && !showsRoadmap) continue;
    const base = fileSlug(board.title) || texts.boardFile;
    let name = base;
    for (let copy = 2; taken.has(name); copy += 1) name = `${base}-${String(copy)}`;
    taken.add(name);
    diagrams.push({
      title: board.title,
      path: `${DIAGRAMS_DIR}/${name}.md`,
      content: boardToMermaid({
        title: board.title,
        nodes: board.nodes,
        edges: board.edges,
        roadmap: showsRoadmap ? roadmap : null,
        language,
      }),
    });
  }
  return diagrams;
}

function milestoneLine(milestone: RoadmapMilestone, texts: CodingPackageTexts): string {
  const name = texts.milestone(milestone.number, markdownLine(milestone.title));
  return milestone.duration ? `${name} (${markdownLine(milestone.duration.text)})` : name;
}

/** `CLAUDE.md` and `AGENTS.md`: what to read in which order, and how to work. */
function instructions(
  input: CodingPackageInput,
  texts: CodingPackageTexts,
  date: string,
  hasDiagrams: boolean,
): string[] {
  const open = (text: string) => (text.trim() ? '' : ` (${texts.stillOpen})`);
  const openCode = open(input.texts.code_standards);
  const openUi = open(input.texts.ui_direction);
  const reads = [
    { path: PACKAGE_PATHS.overview, what: texts.reads.overview },
    { path: PACKAGE_PATHS.architecture, what: texts.reads.architecture },
    { path: PACKAGE_PATHS.decisions, what: texts.reads.decisions },
    { path: PACKAGE_PATHS.codeStandards, what: `${texts.reads.codeStandards}${openCode}` },
    { path: PACKAGE_PATHS.ui, what: `${texts.reads.ui}${openUi}` },
    { path: PACKAGE_PATHS.plan, what: texts.reads.plan },
    { path: PACKAGE_PATHS.tracker, what: texts.reads.tracker },
  ];
  const rules = [...texts.rules];
  // The rule about what is open stands before the last one, "ask instead of guessing".
  if (openCode || openUi) rules.splice(rules.length - 1, 0, texts.openRule);
  return [
    `# ${markdownLine(input.projectName)}`,
    texts.intro(date),
    `## ${texts.readFirst}`,
    reads.map(({ path, what }, index) => `${String(index + 1)}. \`${path}\`: ${what}`).join('\n'),
    hasDiagrams && texts.diagramsAt,
    `## ${texts.wayOfWorking}`,
    rules.map((rule) => `- ${rule}`).join('\n'),
    texts.sameContent,
  ].filter((block): block is string => Boolean(block));
}

function sectionMarkdown(
  sections: Partial<Record<PlanSection, PlanNode[]>>,
  section: PlanSection,
  texts: CodingPackageTexts,
): string {
  return planNodesToMarkdown(sections[section] ?? []).trim() || texts.nothingYet;
}

function decisionsFile(
  input: CodingPackageInput,
  texts: CodingPackageTexts,
  day: (date: Date) => string,
): PackageFile {
  const decided = input.decisions.filter((decision) => decision.status === 'decided');
  const open = input.decisions.filter((decision) => decision.status === 'open');
  const blocks: (string | false)[] = [
    `# ${texts.decisionsTitle}: ${markdownLine(input.projectName)}`,
    texts.decisionsIntro,
    `## ${texts.decided}`,
    decided.length === 0 && texts.noDecisions,
  ];
  for (const decision of decided) {
    const alternatives = decision.alternatives.map((alternative) => {
      const note = alternative.note.trim() ? `: ${markdownLine(alternative.note)}` : '';
      return `- ${markdownLine(alternative.name)}${note}`;
    });
    const at = decision.decidedAt ? new Date(decision.decidedAt) : null;
    blocks.push(
      `### ${markdownLine(decision.topic)}`,
      `**${texts.decision}:** ${markdownLine(decision.value ?? '')}`,
      decision.reasoning.trim(),
      alternatives.length > 0 && `**${texts.alternatives}:**\n${alternatives.join('\n')}`,
      at !== null &&
        !Number.isNaN(at.getTime()) &&
        texts.decidedOn(day(at), decision.decidedBy ? markdownLine(decision.decidedBy) : null),
    );
  }
  if (open.length > 0) {
    blocks.push(
      `## ${texts.openDecisions}`,
      texts.openDecisionsIntro,
      open
        .map((decision) => {
          const reason = decision.reopenReason?.trim();
          return `- ${markdownLine(decision.topic)}${
            reason ? ` (${texts.reopened(markdownLine(reason))})` : ''
          }`;
        })
        .join('\n'),
    );
  }
  return file(PACKAGE_PATHS.decisions, blocks);
}

/** The text of the team under its title, or the note that it is open. */
function teamText(path: string, title: string, text: string, open: string): PackageFile {
  return file(path, [`# ${title}`, text.trim() || open]);
}

function specFile(spec: Spec, texts: CodingPackageTexts, planTitle: string): PackageFile {
  const context = [
    { name: texts.overviewTitle, target: 'project-overview.md' },
    { name: texts.architectureTitle, target: 'architecture.md' },
    { name: texts.decisionsTitle, target: 'decisions.md' },
    { name: texts.codeStandardsTitle, target: 'code-standards.md' },
    { name: texts.uiTitle, target: 'ui-context.md' },
    { name: planTitle, target: 'project-plan.md' },
  ];
  return file(`${SPECS_DIR}/${spec.name}`, [
    `# ${spec.number} ${markdownLine(spec.title)}`,
    `> ${texts.skeleton}`,
    `## ${texts.task}`,
    markdownLine(spec.text),
    `## ${texts.milestoneHeading}`,
    milestoneLine(spec.milestone, texts),
    spec.milestone.goal.trim() && markdownLine(spec.milestone.goal),
    spec.assignee !== null && `## ${texts.assignee}`,
    spec.assignee !== null && markdownLine(spec.assignee),
    `## ${texts.context}`,
    context.map(({ name, target }) => `- [${name}](../${target})`).join('\n'),
    `## ${texts.checklist}`,
    texts.checks.map((check) => `- [ ] ${check}`).join('\n'),
  ]);
}

function parts(input: CodingPackageInput) {
  const texts = codingPackageTexts(input.language);
  const sections = planSectionsOf(input.plan);
  const roadmap = readRoadmap(sections);
  return {
    texts,
    sections,
    roadmap,
    specs: specsOf(roadmap, input.assignees, texts),
    diagrams: diagramsOf(input, roadmap, texts),
  };
}

/**
 * The files of the package (spec 27b), in their order: `CLAUDE.md` and `AGENTS.md`, the context
 * files, a feature spec per task of the plan and a file of diagrams per board with content.
 * Without a plan there is no package: the result is empty.
 */
export function buildCodingPackage(input: CodingPackageInput): PackageFile[] {
  if (!planHasContent(input.plan)) return [];
  const { texts, sections, roadmap, specs, diagrams } = parts(input);
  const name = markdownLine(input.projectName);
  const days = new Intl.DateTimeFormat(input.language, {
    dateStyle: 'long',
    ...(input.timeZone ? { timeZone: input.timeZone } : {}),
  });
  const day = (date: Date) => days.format(date);
  const today = day(input.date);
  const guide = instructions(input, texts, today, diagrams.length > 0);
  const specsOfMilestone = (milestone: RoadmapMilestone) =>
    specs.filter((spec) => spec.milestone === milestone);

  return [
    file(PACKAGE_PATHS.claude, guide),
    file(PACKAGE_PATHS.agents, guide),
    file(PACKAGE_PATHS.overview, [
      `# ${texts.overviewTitle}: ${name}`,
      `## ${planSectionTitle('scope', input.language)}`,
      sectionMarkdown(sections, 'scope', texts),
      input.criteria.length > 0 && `## ${texts.criteria}`,
      input.criteria.length > 0 && texts.criteriaIntro,
      input.criteria.length > 0 &&
        input.criteria.map((criterion) => `- ${markdownLine(criterion)}`).join('\n'),
      texts.moreInPlan,
    ]),
    file(PACKAGE_PATHS.architecture, [
      `# ${texts.architectureTitle}: ${name}`,
      `## ${planSectionTitle('tech', input.language)}`,
      sectionMarkdown(sections, 'tech', texts),
      `## ${texts.diagrams}`,
      diagrams.length > 0
        ? diagrams
            .map((diagram) => `- [${markdownLine(diagram.title)}](../${diagram.path})`)
            .join('\n')
        : texts.noDiagrams,
      texts.reasonsAt,
    ]),
    decisionsFile(input, texts, day),
    teamText(
      PACKAGE_PATHS.codeStandards,
      `${texts.codeStandardsTitle}: ${name}`,
      input.texts.code_standards,
      texts.codeStandardsOpen,
    ),
    teamText(PACKAGE_PATHS.ui, `${texts.uiTitle}: ${name}`, input.texts.ui_direction, texts.uiOpen),
    {
      path: PACKAGE_PATHS.plan,
      content: planExportMarkdown({
        projectName: input.projectName,
        nodes: input.plan,
        assignees: input.assignees,
        language: input.language,
      }),
    },
    file(PACKAGE_PATHS.tracker, [
      `# ${texts.trackerTitle}: ${name}`,
      texts.trackerIntro(today),
      `## ${texts.inProgress}`,
      texts.nothing,
      `## ${texts.milestonesAndTasks}`,
      roadmap.milestones.length === 0 && texts.noTasks,
      ...roadmap.milestones.flatMap((milestone) => {
        const own = specsOfMilestone(milestone);
        return [
          `### ${milestoneLine(milestone, texts)}`,
          own.length > 0
            ? own
                .map(
                  (spec) =>
                    `- [ ] [${spec.number} ${markdownLine(spec.title)}](feature-specs/${spec.name})${
                      spec.assignee ? ` (${markdownLine(spec.assignee)})` : ''
                    }`,
                )
                .join('\n')
            : texts.noTasksInMilestone,
        ];
      }),
      `## ${texts.notes}`,
      texts.notesHint,
    ]),
    file(PACKAGE_PATHS.specs, [
      `# ${texts.specsTitle}: ${name}`,
      specs.length > 0 ? texts.specsIntro : texts.noTasks,
      ...roadmap.milestones.flatMap((milestone) => {
        const own = specsOfMilestone(milestone);
        return [
          `## ${milestoneLine(milestone, texts)}`,
          milestone.goal.trim() && markdownLine(milestone.goal),
          own.length > 0
            ? own
                .map((spec) => `- [${spec.number} ${markdownLine(spec.title)}](${spec.name})`)
                .join('\n')
            : texts.noTasksInMilestone,
        ];
      }),
    ]),
    ...specs.map((spec) => specFile(spec, texts, exportTexts(input.language).plan)),
    ...diagrams.map((diagram) => ({ path: diagram.path, content: diagram.content })),
  ];
}

/** What the package of a project holds (spec 27b): the counts and the paths of its files. */
export function codingPackageSummary(input: CodingPackageInput): CodingPackageSummary {
  const hasPlan = planHasContent(input.plan);
  const { roadmap, specs, diagrams } = parts(input);
  return {
    hasPlan,
    milestones: roadmap.milestones.length,
    tasks: specs.length,
    decisions: {
      decided: input.decisions.filter((decision) => decision.status === 'decided').length,
      open: input.decisions.filter((decision) => decision.status === 'open').length,
    },
    diagrams: diagrams.length,
    files: hasPlan ? buildCodingPackage(input).map((entry) => entry.path) : [],
  };
}
