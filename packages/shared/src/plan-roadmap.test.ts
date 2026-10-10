import { describe, expect, it } from 'vitest';

import { planNodesFromMarkdown } from './plan-markdown';
import {
  MAX_MILESTONE_WEEKS,
  MAX_MILESTONES,
  milestoneProgress,
  parseDuration,
  readRoadmap,
  ROADMAP,
  roadmapLayout,
  roadmapWeeks,
  withIssues,
  type Roadmap,
  type RoadmapIssue,
  type RoadmapMilestone,
} from './plan-roadmap';

/** A task as it is read from a plan the server has not given ids yet. */
const task = (text: string) => ({ id: null, text, assignee: null });

const roadmapOf = (milestones: string, costs = '') =>
  readRoadmap({
    milestones: planNodesFromMarkdown(milestones),
    costs: planNodesFromMarkdown(costs),
  });

describe('parseDuration', () => {
  it('reads weeks, days and months, also as a range and with "about"', () => {
    expect(parseDuration('3 Wochen')).toEqual({ text: '3 Wochen', weeks: 3 });
    expect(parseDuration('1 Woche')).toEqual({ text: '1 Woche', weeks: 1 });
    expect(parseDuration(' 2–3 Wochen ')).toEqual({ text: '2–3 Wochen', weeks: 3 });
    expect(parseDuration('2 - 4 weeks')).toEqual({ text: '2 - 4 weeks', weeks: 3 });
    expect(parseDuration('ca. 10 Arbeitstage')).toEqual({ text: 'ca. 10 Arbeitstage', weeks: 2 });
    expect(parseDuration('15 days')?.weeks).toBe(3);
    expect(parseDuration('1 Monat')?.weeks).toBe(4);
    expect(parseDuration('1,5 Monate')?.weeks).toBe(7);
    expect(parseDuration('2 bis 3 Wochen')?.weeks).toBe(3);
    // Short times still take a week.
    expect(parseDuration('2 Tage')?.weeks).toBe(1);
  });

  it('reads nothing else', () => {
    expect(parseDuration('MVP')).toBeNull();
    expect(parseDuration('3')).toBeNull();
    expect(parseDuration('3 Wochen und mehr')).toBeNull();
    expect(parseDuration('0 Wochen')).toBeNull();
    expect(parseDuration('4–2 Wochen')).toBeNull();
  });

  it('takes a time beyond two years as no time', () => {
    expect(parseDuration('104 Wochen')?.weeks).toBe(MAX_MILESTONE_WEEKS);
    expect(parseDuration('105 Wochen')).toBeNull();
    expect(parseDuration('9999999999 Wochen')).toBeNull();
    expect(parseDuration('10000000 Monate')).toBeNull();
    expect(parseDuration(`${'9'.repeat(400)} Wochen`)).toBeNull();
  });
});

describe('readRoadmap', () => {
  it('reads milestones as headings with their goal, time and tasks', () => {
    const roadmap = roadmapOf(
      [
        'Zuerst steht das Grundgerüst.',
        '',
        '### Meilenstein 1: Grundgerüst und Anmeldung (3 Wochen)',
        '',
        'Frontend, API und Datenbank laufen.',
        '',
        '- Projekt **aufsetzen**',
        '  - mit Vorlage',
        '- Login per E-Mail-Link',
        '',
        'Eine Notiz nach den Aufgaben.',
        '',
        '### Milestone 2 - Mitglieder (2–3 weeks)',
        '',
        '1. Tabelle anlegen',
        '2. Liste bauen',
        '',
        '### Trainingszeiten',
      ].join('\n'),
    );

    expect(roadmap.milestones).toEqual([
      {
        number: 1,
        title: 'Grundgerüst und Anmeldung',
        goal: 'Frontend, API und Datenbank laufen.',
        duration: { text: '3 Wochen', weeks: 3 },
        tasks: [task('Projekt aufsetzen'), task('Login per E-Mail-Link')],
      },
      {
        number: 2,
        title: 'Mitglieder',
        goal: '',
        duration: { text: '2–3 weeks', weeks: 3 },
        tasks: [task('Tabelle anlegen'), task('Liste bauen')],
      },
      { number: 3, title: 'Trainingszeiten', goal: '', duration: null, tasks: [] },
    ]);
  });

  it('keeps a title in parentheses that is no time, and a title that is only a number', () => {
    const { milestones } = roadmapOf('### Meilenstein 1: Login (Magic Link)\n\n### Meilenstein 2');

    expect(milestones.map((milestone) => [milestone.title, milestone.duration])).toEqual([
      ['Login (Magic Link)', null],
      ['Meilenstein 2', null],
    ]);
  });

  it('reads names in the forms people write them', () => {
    const { milestones } = roadmapOf(
      [
        '### 1. Grundgerüst (3 Wochen).',
        '### Meilenstein 2 Mitglieder',
        '### M3 Export',
        '### Mobile App',
      ].join('\n\n'),
    );

    expect(milestones.map((milestone) => [milestone.title, milestone.duration?.weeks])).toEqual([
      ['Grundgerüst', 3],
      ['Mitglieder', undefined],
      ['Export', undefined],
      ['Mobile App', undefined],
    ]);
  });

  it('takes the headings of the third level as milestones, whatever stands around them', () => {
    // The Markdown of the moderator knows one level; people can write others in the editor.
    const withLevels = (markdown: string, levels: Record<string, number>) =>
      planNodesFromMarkdown(markdown).map((node) => {
        const level = node.type === 'heading' ? levels[node.content?.[0]?.text ?? ''] : undefined;
        return level === undefined ? node : { ...node, attrs: { ...node.attrs, level } };
      });
    const nodes = withLevels(
      [
        '### Meilenstein 1: Grundgerüst',
        '',
        'Das Fundament steht.',
        '',
        '### Aufgaben',
        '',
        '- Projekt aufsetzen',
        '- Login',
        '',
        '### Später',
        '',
        '- Eine Notiz, keine Aufgabe',
        '',
        '### Meilenstein 2: Mitglieder',
        '',
        '- Liste bauen',
      ].join('\n'),
      { Aufgaben: 4, Später: 2 },
    );

    const { milestones } = readRoadmap({ milestones: nodes });

    // A deeper heading belongs to its milestone; a higher one ends it and is none itself.
    expect(milestones.map((milestone) => [milestone.title, milestone.tasks.length])).toEqual([
      ['Grundgerüst', 2],
      ['Mitglieder', 1],
    ]);
    expect(milestones[0]?.goal).toBe('Das Fundament steht.');
  });

  it('takes the highest level as milestones when the section has no third level', () => {
    const nodes = planNodesFromMarkdown('### Grundgerüst\n\n- Login\n\n### Mitglieder').map(
      (node) => (node.type === 'heading' ? { ...node, attrs: { level: 2 } } : node),
    );

    expect(readRoadmap({ milestones: nodes }).milestones.map((entry) => entry.title)).toEqual([
      'Grundgerüst',
      'Mitglieder',
    ]);
  });

  it('reads the items of a list as milestones when the section has no headings', () => {
    const { milestones } = roadmapOf(
      '1. Grundgerüst (2 Wochen)\n   - Projekt aufsetzen\n   - Login\n2. Mitglieder\n\nEine Notiz.',
    );

    expect(milestones).toEqual([
      {
        number: 1,
        title: 'Grundgerüst',
        goal: '',
        duration: { text: '2 Wochen', weeks: 2 },
        tasks: [task('Projekt aufsetzen'), task('Login')],
      },
      { number: 2, title: 'Mitglieder', goal: '', duration: null, tasks: [] },
    ]);
  });

  it('takes a missing time from the section on costs and time', () => {
    const { milestones } = roadmapOf(
      '### Meilenstein 1: Grundgerüst\n\n### Meilenstein 2: Mitglieder (1 Woche)\n\n### Meilenstein 3: Export',
      [
        'Grundlage ist das Kriterium "MVP in 3 Monaten".',
        '',
        '- Meilenstein 1: 3 Wochen',
        '- **Meilenstein 2:** 4 Wochen',
        '- M3 (Export): rund 2 Wochen, weil die Kasse wartet',
        '- PM 9 Wochen',
      ].join('\n'),
    );

    expect(milestones.map((milestone) => milestone.duration)).toEqual([
      { text: '3 Wochen', weeks: 3 },
      // The heading's own time wins.
      { text: '1 Woche', weeks: 1 },
      { text: 'rund 2 Wochen', weeks: 2 },
    ]);
  });

  it('matches a milestone in the costs only as a word of its own, each in its part of a line', () => {
    const { milestones } = roadmapOf(
      '### Meilenstein 1: Grundgerüst\n\n### Meilenstein 2: Mitglieder\n\n### Meilenstein 3: Export',
      [
        '- Plattform 2: 6 Wochen Einarbeitung',
        '- Buffer: from 3 to 5 weeks extra',
        '- Meilenstein 1 3 Wochen, Meilenstein 2 4 Wochen',
      ].join('\n'),
    );

    expect(milestones.map((milestone) => milestone.duration?.weeks ?? null)).toEqual([3, 4, null]);
  });

  it('shows at most 24 milestones', () => {
    const headings = Array.from(
      { length: 30 },
      (_, index) => `### Schritt ${String(index + 1)}`,
    ).join('\n\n');

    expect(roadmapOf(headings).milestones).toHaveLength(MAX_MILESTONES);
  });

  it('is empty without milestones', () => {
    expect(readRoadmap({})).toEqual({ milestones: [] });
    expect(roadmapOf('Hier entsteht der Plan.').milestones).toEqual([]);
  });
});

const milestone = (
  number: number,
  weeks: number | null,
  tasks = 0,
  goal = '',
): RoadmapMilestone => ({
  number,
  title: `Schritt ${String(number)}`,
  goal,
  duration: weeks === null ? null : { text: `${String(weeks)} Wochen`, weeks },
  tasks: Array.from({ length: tasks }, (_, index) => task(`Aufgabe ${String(index + 1)}`)),
});

describe('roadmapWeeks and roadmapLayout', () => {
  it('scales the columns by their weeks when every milestone has a time', () => {
    const roadmap: Roadmap = { milestones: [milestone(1, 3, 2, 'Ziel'), milestone(2, 4)] };
    const layout = roadmapLayout(roadmap);

    expect(roadmapWeeks(roadmap)).toBe(7);
    // The shortest milestone gets at least the narrowest column: 220 / 3 → 74 px a week.
    expect(layout.scale).toEqual({ week: 74, weeks: 7 });
    expect(layout.columns.map((column) => [column.x, column.width, column.weeks])).toEqual([
      [ROADMAP.side, 222, { from: 1, to: 3 }],
      [ROADMAP.side + 222, 296, { from: 4, to: 7 }],
    ]);
    expect(layout.top).toBe(ROADMAP.top + ROADMAP.scale + ROADMAP.scaleGap);
    const tallest =
      2 * ROADMAP.padding +
      ROADMAP.title +
      ROADMAP.meta +
      ROADMAP.blockGap +
      ROADMAP.goal +
      ROADMAP.blockGap +
      2 * ROADMAP.task +
      ROADMAP.taskGap;
    expect(layout.columnHeight).toBe(tallest);
    expect(layout.size).toEqual({
      width: ROADMAP.side + 222 + 296 + ROADMAP.side,
      height: layout.top + tallest + ROADMAP.bottom,
    });
  });

  it('keeps weeks between the narrowest and the widest week', () => {
    expect(roadmapLayout({ milestones: [milestone(1, 1), milestone(2, 2)] }).scale?.week).toBe(
      ROADMAP.week.max,
    );
    expect(roadmapLayout({ milestones: [milestone(1, 8)] }).scale?.week).toBe(ROADMAP.week.min);
  });

  it('drops the scale when it would get too wide, and stays within bounds', () => {
    // Two years next to one week: 105 weeks at 160 px each.
    const long = roadmapLayout({ milestones: [milestone(1, 1), milestone(2, 104)] });
    expect(long.scale).toBeNull();
    expect(long.columns.map((column) => column.width)).toEqual([ROADMAP.column, ROADMAP.column]);

    const many = roadmapLayout({
      milestones: Array.from({ length: 40 }, (_, index) => milestone(index + 1, 104, 500)),
    });
    expect(many.columns).toHaveLength(24);
    expect(many.size.width).toBeLessThanOrEqual(6000);
    expect(many.size.height).toBeLessThanOrEqual(1000);
    expect(Number.isFinite(many.size.width)).toBe(true);
  });

  it('makes all columns equally wide while a time is missing', () => {
    const roadmap: Roadmap = { milestones: [milestone(1, 3), milestone(2, null, 15)] };
    const layout = roadmapLayout(roadmap);

    expect(roadmapWeeks(roadmap)).toBeNull();
    expect(layout.scale).toBeNull();
    expect(layout.top).toBe(ROADMAP.top);
    expect(layout.columns.map((column) => [column.width, column.weeks])).toEqual([
      [ROADMAP.column, null],
      [ROADMAP.column, null],
    ]);
    expect(layout.columns[1]).toMatchObject({ shownTasks: 12, moreTasks: 3 });
    expect(layout.hasGoals).toBe(false);
  });

  it('has a size of its own without milestones, and never gets smaller than a frame', () => {
    expect(roadmapLayout({ milestones: [] }).size).toEqual(ROADMAP.empty);
    const small = roadmapLayout({ milestones: [milestone(1, null)] }).size;
    expect(small.width).toBeGreaterThanOrEqual(240);
    expect(small.height).toBeGreaterThanOrEqual(160);
  });
});

describe('withIssues and milestoneProgress', () => {
  const SETUP = '7a000000-0000-4000-8000-000000000001';
  const LOGIN = '7a000000-0000-4000-8000-000000000002';
  const LIST = '7a000000-0000-4000-8000-000000000003';
  const issue = (number: number, closed: boolean): RoadmapIssue => ({
    number,
    url: `https://gitlab.example.com/verein/app/-/issues/${String(number)}`,
    closed,
  });
  const roadmap: Roadmap = {
    milestones: [
      {
        number: 1,
        title: 'Grundgerüst',
        goal: '',
        duration: null,
        tasks: [
          { id: SETUP, text: 'Projekt aufsetzen', assignee: null },
          { id: LOGIN, text: 'Login per Link', assignee: null },
          // Written a moment ago: without an id it cannot have an issue.
          { id: null, text: 'Abnahme', assignee: null },
        ],
      },
      {
        number: 2,
        title: 'Mitglieder',
        goal: '',
        duration: null,
        tasks: [{ id: LIST, text: 'Mitgliederliste', assignee: null }],
      },
    ],
  };

  it('puts every issue at its task, and null where there is none', () => {
    const withThem = withIssues(
      roadmap,
      new Map([
        [SETUP, issue(4, true)],
        [LOGIN, issue(5, false)],
      ]),
    );

    expect(withThem.milestones.map((entry) => entry.tasks.map((task) => task.issue))).toEqual([
      [issue(4, true), issue(5, false), null],
      [null],
    ]);
    // Everything else stays as it was.
    expect(withThem.milestones[0]?.tasks[0]).toMatchObject({ id: SETUP, assignee: null });
  });

  it('leaves a roadmap without issues as it is', () => {
    expect(withIssues(roadmap, new Map())).toBe(roadmap);
  });

  it('counts the tasks of a milestone, their issues and how many are done', () => {
    const withThem = withIssues(
      roadmap,
      new Map([
        [SETUP, issue(4, true)],
        [LOGIN, issue(5, false)],
      ]),
    );

    // A task without an issue has no status: it counts as a task, and not as done.
    expect(withThem.milestones.map(milestoneProgress)).toEqual([
      { tasks: 3, issues: 2, done: 1 },
      { tasks: 1, issues: 0, done: 0 },
    ]);
    const [first] = roadmap.milestones;
    if (!first) throw new Error('The milestone is missing');
    expect(milestoneProgress(first)).toEqual({ tasks: 3, issues: 0, done: 0 });
  });
});
