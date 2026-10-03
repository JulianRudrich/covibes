import { z } from 'zod';

import { FRAME_MIN_SIZE, type Size } from './canvas/model';
import type { PlanNode, PlanSection } from './plan';
import { listItemText, taskIdOf } from './plan-tasks';

// The roadmap (spec 26a): the milestones of the plan with their times, goals and tasks, read from
// the plan as it stands. The plan is the source; the roadmap holds nothing of its own.

export const roadmapDurationSchema = z.object({
  /** The time as the plan says it, e.g. "2–3 Wochen". */
  text: z.string(),
  /** The time in whole weeks, at least one. */
  weeks: z.number().int().min(1),
});
export type RoadmapDuration = z.infer<typeof roadmapDurationSchema>;

/** Who took a task (spec 26b); the read-only view names nobody (`NO_USER_ID`, no name). */
export const roadmapAssigneeSchema = z.object({ userId: z.uuid(), name: z.string() });
export type RoadmapAssignee = z.infer<typeof roadmapAssigneeSchema>;

export const roadmapTaskSchema = z.object({
  /** The id the task carries in the plan; null until the server gave it one (spec 26b). */
  id: z.uuid().nullable(),
  text: z.string(),
  assignee: roadmapAssigneeSchema.nullable(),
});
export type RoadmapTask = z.infer<typeof roadmapTaskSchema>;

/** `PUT …/roadmap/tasks/:taskId/assignee`: the member who takes the task, or null for nobody. */
export const assignTaskInputSchema = z.object({ userId: z.uuid().nullable() }).strict();
export type AssignTaskInput = z.infer<typeof assignTaskInputSchema>;

export const roadmapMilestoneSchema = z.object({
  /** Its place in the order of the plan, from 1. */
  number: z.number().int().min(1),
  title: z.string(),
  /** The first paragraph below its heading; empty if there is none. */
  goal: z.string(),
  duration: roadmapDurationSchema.nullable(),
  tasks: z.array(roadmapTaskSchema),
});
export type RoadmapMilestone = z.infer<typeof roadmapMilestoneSchema>;

export const roadmapSchema = z.object({ milestones: z.array(roadmapMilestoneSchema) });
export type Roadmap = z.infer<typeof roadmapSchema>;

/** Where a project's roadmap is: the board and the frame that show it (spec 26a). */
export type RoadmapPlace = { boardId: string; nodeId: string };

/** The title of a new roadmap frame, the same in every language. */
export const ROADMAP_TITLE = 'Roadmap';

const NUMBER = String.raw`(\d+(?:[.,]\d+)?)`;
const RANGE = String.raw`(?:\s*(?:-|–|—|bis|to)\s*${NUMBER})?`;
const ABOUT = String.raw`(?:(?:ca\.?|circa|etwa|rund|about|approx\.?|around|~)\s*)?`;
// Longer words first, so "Wochen" is not read as "Woche".
const UNIT = String.raw`(Arbeitstagen|Arbeitstage|Arbeitstag|Werktagen|Werktage|Werktag|working days|working day|Tagen|Tage|Tag|days|day|Wochen|Woche|Wo\.|weeks|week|wks|wk|Monaten|Monate|Monat|months|month)`;
const DURATION = `${ABOUT}${NUMBER}${RANGE}\\s*${UNIT}`;

/**
 * The longest time a milestone can take, two years. Anything beyond is no estimate (a typo, or
 * text that only looks like a time) and counts as no time, so a roadmap never grows without end.
 */
export const MAX_MILESTONE_WEEKS = 104;

/** The milestones a roadmap shows; a plan has three to five. */
export const MAX_MILESTONES = 24;

/** Weeks per unit: days are working days, five to a week; a month has four and a third weeks. */
function weeksPer(unit: string): number {
  const lower = unit.toLowerCase();
  if (/^(arbeitstag|werktag|working day|tag|day)/.test(lower)) return 1 / 5;
  if (/^(monat|month)/.test(lower)) return 13 / 3;
  return 1;
}

function toDuration(match: RegExpMatchArray): RoadmapDuration | null {
  const [text, low, high, unit] = match;
  if (low === undefined || unit === undefined) return null;
  const from = Number(low.replace(',', '.'));
  const to = high === undefined ? from : Number(high.replace(',', '.'));
  if (!Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to < from) return null;
  const weeks = Math.max(1, Math.round(((from + to) / 2) * weeksPer(unit)));
  if (weeks > MAX_MILESTONE_WEEKS) return null;
  return { text: text.trim(), weeks };
}

/** A time such as "3 Wochen", "2–3 weeks", "ca. 10 Arbeitstage" or "1 Monat"; null otherwise. */
export function parseDuration(text: string): RoadmapDuration | null {
  const match = new RegExp(`^\\s*${DURATION}\\s*$`, 'iu').exec(text);
  return match ? toDuration(match) : null;
}

/** The first time anywhere in a text, e.g. in "Meilenstein 2: 3 Wochen, weil …". */
function findDuration(text: string): RoadmapDuration | null {
  const match = new RegExp(`(?<![\\p{L}\\d])${DURATION}(?![\\p{L}])`, 'iu').exec(text);
  return match ? toDuration(match) : null;
}

/** The text of a node and everything in it, without formats. */
function textOf(node: PlanNode): string {
  if (node.type === 'text') return node.text ?? '';
  return (node.content ?? []).map(textOf).join('');
}

/** A list item as a task: its text, the id it carries in the plan, and nobody on it yet. */
function taskOf(item: PlanNode): RoadmapTask {
  return { id: taskIdOf(item), text: listItemText(item), assignee: null };
}

const isList = (node: PlanNode) => node.type === 'bulletList' || node.type === 'orderedList';
const itemsOf = (list: PlanNode) =>
  (list.content ?? []).filter((child) => child.type === 'listItem');

/** "Meilenstein 1: Grundgerüst (3 Wochen)" → the name "Grundgerüst" and its time. */
function splitTitle(text: string): { title: string; duration: RoadmapDuration | null } {
  let title = text.replace(/\s+/g, ' ').trim();
  let duration: RoadmapDuration | null = null;
  const time = /\(([^()]*)\)[\s.]*$/.exec(title);
  if (time?.[1] !== undefined) {
    duration = parseDuration(time[1]);
    if (duration) title = title.slice(0, time.index).trim();
  }
  // "Meilenstein 1: Name", "Milestone 1 - Name", "M1 Name" and "1. Name" all name "Name".
  const name = title
    .replace(/^(?:Meilenstein|Milestone|Phase|M)\s*\d+\s*(?:[:.\-–—]\s*|\s+)/iu, '')
    .replace(/^\d+\s*[.:)]\s*/u, '');
  return { title: name || title, duration };
}

type Draft = Omit<RoadmapMilestone, 'number'>;

/** The level of the headings that the plan's editor and the moderator write below a section. */
const MILESTONE_LEVEL = 3;

function levelOf(heading: PlanNode): number {
  const level = heading.attrs?.level;
  return typeof level === 'number' ? level : MILESTONE_LEVEL;
}

/**
 * Milestones as headings, each with a goal and lists of tasks below it. Milestones are the
 * headings of the third level, or of the highest level the section has when it has none of the
 * third. A deeper heading ("#### Aufgaben") belongs to the milestone it stands in, and so do the
 * lists below it; a higher one ends the milestone before it.
 */
function fromHeadings(nodes: readonly PlanNode[]): Draft[] {
  const levels = nodes.filter((node) => node.type === 'heading').map(levelOf);
  const level = levels.includes(MILESTONE_LEVEL) ? MILESTONE_LEVEL : Math.min(...levels);
  const milestones: Draft[] = [];
  let current: Draft | undefined;
  for (const node of nodes) {
    if (node.type === 'heading') {
      if (levelOf(node) > level) continue;
      if (levelOf(node) < level) {
        current = undefined;
        continue;
      }
      current = { ...splitTitle(textOf(node)), goal: '', tasks: [] };
      milestones.push(current);
    } else if (!current) {
      continue;
    } else if (isList(node)) {
      for (const item of itemsOf(node)) {
        const task = taskOf(item);
        if (task.text) current.tasks.push(task);
      }
    } else if (node.type === 'paragraph' && current.goal === '' && current.tasks.length === 0) {
      current.goal = textOf(node).replace(/\s+/g, ' ').trim();
    }
  }
  return milestones;
}

/** Milestones as the items of a list, each with its tasks nested in it. */
function fromList(nodes: readonly PlanNode[]): Draft[] {
  return nodes.filter(isList).flatMap((list) =>
    itemsOf(list).flatMap((item): Draft[] => {
      const text = listItemText(item);
      if (!text) return [];
      const tasks = (item.content ?? [])
        .filter(isList)
        .flatMap(itemsOf)
        .map(taskOf)
        .filter((task) => task.text !== '');
      return [{ ...splitTitle(text), goal: '', tasks }];
    }),
  );
}

/** Times that the section on costs and time gives per milestone, by the milestone's number. */
function durationsFromCosts(nodes: readonly PlanNode[]): Map<number, RoadmapDuration> {
  const lines: string[] = [];
  const collect = (node: PlanNode) => {
    if (node.type === 'paragraph' || node.type === 'heading') lines.push(textOf(node));
    for (const child of node.content ?? []) if (child.type !== 'text') collect(child);
  };
  nodes.forEach(collect);

  const durations = new Map<number, RoadmapDuration>();
  for (const line of lines) {
    // A word of its own: the "m" at the end of "Plattform 2" names no milestone.
    const mentions = [
      ...line.matchAll(/(?<![\p{L}\d])(?:Meilenstein|Milestone|M)\s*(\d+)(?![\p{L}\d])/giu),
    ];
    mentions.forEach((mention, index) => {
      const number = Number(mention[1]);
      // Its time stands between it and the next milestone the line names.
      const from = mention.index + mention[0].length;
      const duration = findDuration(line.slice(from, mentions[index + 1]?.index));
      if (duration && !durations.has(number)) durations.set(number, duration);
    });
  }
  return durations;
}

/**
 * The roadmap of a plan (spec 26a): the milestones of the section "milestones" in their order.
 * A milestone is a heading in that section, or, without headings, an item of a list. Its time
 * stands in parentheses at the end of its title; without it, a line of the section "costs" that
 * names the milestone by its number gives it. A roadmap has at most `MAX_MILESTONES` milestones.
 */
export function readRoadmap(sections: Partial<Record<PlanSection, PlanNode[]>>): Roadmap {
  const nodes = sections.milestones ?? [];
  const drafts = nodes.some((node) => node.type === 'heading')
    ? fromHeadings(nodes)
    : fromList(nodes);
  const fromCosts = durationsFromCosts(sections.costs ?? []);
  return {
    milestones: drafts.slice(0, MAX_MILESTONES).map((draft, index) => ({
      ...draft,
      number: index + 1,
      duration: draft.duration ?? fromCosts.get(index + 1) ?? null,
    })),
  };
}

/**
 * The roadmap with who took which task (spec 26b): `assignees` by the id of the task. A task
 * without an id, or with one nobody took, stays without an assignee.
 */
export function withAssignees(
  roadmap: Roadmap,
  assignees: ReadonlyMap<string, RoadmapAssignee>,
): Roadmap {
  return {
    milestones: roadmap.milestones.map((milestone) => ({
      ...milestone,
      tasks: milestone.tasks.map((task) => ({
        ...task,
        assignee: (task.id ? assignees.get(task.id) : undefined) ?? null,
      })),
    })),
  };
}

/** All weeks of the roadmap, if every milestone has a time. */
export function roadmapWeeks(roadmap: Roadmap): number | null {
  const { milestones } = roadmap;
  if (milestones.length === 0) return null;
  let weeks = 0;
  for (const milestone of milestones) {
    if (!milestone.duration) return null;
    weeks += milestone.duration.weeks;
  }
  return weeks;
}

/** The measures of a roadmap frame (spec 26a); the web app draws with them. */
export const ROADMAP = {
  /** Where the content starts below the frame's title, and its room to the sides and below. */
  top: 44,
  side: 14,
  bottom: 14,
  /** The scale in weeks above the milestones, and the room below it. */
  scale: 22,
  scaleGap: 6,
  /** The room inside a column. */
  padding: 10,
  title: 22,
  meta: 18,
  /** The goal takes two lines; the room is kept in every column once one milestone has a goal. */
  goal: 38,
  blockGap: 8,
  task: 44,
  taskGap: 6,
  more: 22,
  /** Tasks a column shows before "+ n weitere". */
  visibleTasks: 12,
  /** A column without a time, and the narrowest one with a time. */
  column: 240,
  minColumn: 220,
  week: { min: 64, max: 160 },
  /** The widest scale; a longer roadmap shows its milestones equally wide, without a scale. */
  maxScale: 4800,
  empty: { width: 440, height: 200 },
} as const;

export type RoadmapColumn = {
  x: number;
  width: number;
  /** The weeks it covers, from 1; null without a scale. */
  weeks: { from: number; to: number } | null;
  shownTasks: number;
  moreTasks: number;
};

export type RoadmapLayout = {
  size: Size;
  /** The width of a week and all weeks, if the roadmap has a scale. */
  scale: { week: number; weeks: number } | null;
  /** Where the columns start below the title (and the scale). */
  top: number;
  columnHeight: number;
  hasGoals: boolean;
  columns: RoadmapColumn[];
};

/**
 * Where everything of a roadmap frame goes, relative to the frame, and how large the frame is. The
 * heights are fixed, so the size is known without drawing; the web app and the server use it alike.
 */
export function roadmapLayout(roadmap: Roadmap): RoadmapLayout {
  const milestones = roadmap.milestones.slice(0, MAX_MILESTONES);
  if (milestones.length === 0) {
    return {
      size: { ...ROADMAP.empty },
      scale: null,
      top: ROADMAP.top,
      columnHeight: 0,
      hasGoals: false,
      columns: [],
    };
  }

  const weeks = roadmapWeeks({ milestones });
  const shortest = Math.min(...milestones.map((milestone) => milestone.duration?.weeks ?? 1));
  const fitted = Math.min(
    ROADMAP.week.max,
    Math.max(ROADMAP.week.min, Math.ceil(ROADMAP.minColumn / shortest)),
  );
  // Years of weeks would make a scale nobody reads and a frame nobody finds the end of.
  const week = weeks === null || weeks * fitted > ROADMAP.maxScale ? null : fitted;

  const hasGoals = milestones.some((milestone) => milestone.goal !== '');
  let x = ROADMAP.side;
  let start = 1;
  let tallest = 0;
  const columns = milestones.map((milestone): RoadmapColumn => {
    const span = milestone.duration?.weeks ?? 1;
    const width = week === null ? ROADMAP.column : span * week;
    const shownTasks = Math.min(milestone.tasks.length, ROADMAP.visibleTasks);
    const moreTasks = milestone.tasks.length - shownTasks;
    const tasks =
      shownTasks > 0
        ? ROADMAP.blockGap + shownTasks * (ROADMAP.task + ROADMAP.taskGap) - ROADMAP.taskGap
        : 0;
    const height =
      2 * ROADMAP.padding +
      ROADMAP.title +
      ROADMAP.meta +
      (hasGoals ? ROADMAP.blockGap + ROADMAP.goal : 0) +
      tasks +
      (moreTasks > 0 ? ROADMAP.taskGap + ROADMAP.more : 0);
    tallest = Math.max(tallest, height);
    const column = {
      x,
      width,
      weeks: week === null ? null : { from: start, to: start + span - 1 },
      shownTasks,
      moreTasks,
    };
    x += width;
    start += span;
    return column;
  });

  const top = ROADMAP.top + (week === null ? 0 : ROADMAP.scale + ROADMAP.scaleGap);
  return {
    size: {
      width: Math.max(FRAME_MIN_SIZE.width, x + ROADMAP.side),
      height: Math.max(FRAME_MIN_SIZE.height, top + tallest + ROADMAP.bottom),
    },
    scale: week === null || weeks === null ? null : { week, weeks },
    top,
    columnHeight: tallest,
    hasGoals,
    columns,
  };
}
