import type { PlanLanguage } from './plan';

// What the package for coding agents adds to what the team wrote (spec 27b): headings, the way of
// working and the notes for what is still open. The package is in the project's language, like
// every export; the names of its files are English and always the same.

export type CodingPackageTexts = {
  /** The name of the ZIP, after the project's name. */
  fileName: string;
  /** The first paragraph of `CLAUDE.md` and `AGENTS.md`, with the day the package was made. */
  intro: (date: string) => string;
  readFirst: string;
  /** What each context file is, in the list of what to read. */
  reads: {
    overview: string;
    architecture: string;
    decisions: string;
    codeStandards: string;
    ui: string;
    plan: string;
    tracker: string;
  };
  /** Marks a file the team left open, in the list of what to read. */
  stillOpen: string;
  diagramsAt: string;
  wayOfWorking: string;
  rules: readonly string[];
  /** One more rule while a file is marked as open. */
  openRule: string;
  /** Takes the place of the rule about skeletons once specs are written out. */
  writtenRule: string;
  sameContent: string;

  overviewTitle: string;
  criteria: string;
  criteriaIntro: string;
  moreInPlan: string;
  /** A section of the plan that holds nothing. */
  nothingYet: string;

  architectureTitle: string;
  diagrams: string;
  noDiagrams: string;
  reasonsAt: string;

  decisionsTitle: string;
  decisionsIntro: string;
  decided: string;
  noDecisions: string;
  decision: string;
  alternatives: string;
  decidedOn: (date: string, by: string | null) => string;
  openDecisions: string;
  openDecisionsIntro: string;
  reopened: (reason: string) => string;

  codeStandardsTitle: string;
  codeStandardsOpen: string;
  uiTitle: string;
  uiOpen: string;

  trackerTitle: string;
  trackerIntro: (date: string) => string;
  inProgress: string;
  nothing: string;
  milestonesAndTasks: string;
  notes: string;
  notesHint: string;

  specsTitle: string;
  specsIntro: string;
  /** The intro once specs are written out: the others are marked. */
  specsIntroWritten: string;
  /** Marks a spec that is still a skeleton, in the list of specs. */
  skeletonMark: string;
  noTasks: string;
  /** A milestone without tasks, in the lists of specs. */
  noTasksInMilestone: string;
  milestone: (number: number, title: string) => string;
  skeleton: string;
  task: string;
  milestoneHeading: string;
  assignee: string;
  context: string;
  checklist: string;
  checks: readonly string[];
  /** The name of a spec's file when the task's text gives none. */
  taskFile: string;
  /** The name of a diagram's file when the board's title gives none. */
  boardFile: string;
};

const TEXTS: Readonly<Record<PlanLanguage, CodingPackageTexts>> = {
  de: {
    fileName: 'Coding-Paket',
    intro: (date) =>
      `Das Team hat dieses Projekt in Covibes geplant: Umfang, Entscheidungen, Architektur und Projektplan. Dieses Paket ist der Stand vom ${date}. Du baust das Projekt danach, Spec für Spec.`,
    readFirst: 'Vor jeder Aufgabe lesen, in dieser Reihenfolge',
    reads: {
      overview: 'was gebaut wird und in welchem Umfang',
      architecture: 'Technik, Werkzeuge und Diagramme',
      decisions: 'was das Team entschieden hat und warum',
      codeStandards: 'Konventionen für den Code',
      ui: 'Richtung für die Oberfläche',
      plan: 'der vollständige Projektplan',
      tracker: 'wo das Projekt steht',
    },
    stillOpen: 'noch offen',
    diagramsAt: 'Die Diagramme des Teams liegen als Mermaid in `docs/diagrams/`.',
    wayOfWorking: 'Arbeitsweise',
    rules: [
      'Gearbeitet wird Spec für Spec, in der Reihenfolge der Dateien in `context/feature-specs/`. Ohne Spec kein Code.',
      'Die Specs sind ein Gerüst aus dem Projektplan. Arbeite eine Spec aus, bevor du sie baust (Ziel, Vorgehen, Abgrenzung, Checkliste), und lass sie vom Team bestätigen.',
      'Vor dem Start einer Spec markierst du sie in `context/progress-tracker.md` als „in Arbeit“. Danach hakst du ihre Checkliste ab und aktualisierst den Tracker.',
      'Die Entscheidungen in `context/decisions.md` gelten. Spricht etwas gegen eine Entscheidung, frag das Team, bevor du anders baust.',
      'Fehlt eine Angabe, rate nicht, sondern frag.',
    ],
    openRule:
      'Was als „noch offen“ markiert ist, klärst du mit dem Team vor dem ersten Code und trägst es in die Datei ein.',
    writtenRule:
      'Eine ausgearbeitete Spec setzt du so um, wie sie dasteht. Passt sie nicht zum Stand des Codes oder zu einer Entscheidung, sag es dem Team, bevor du abweichst. Eine Spec mit dem Vermerk „Gerüst“ arbeitest du vor dem Bauen aus (Ziel, Vorgehen, Abgrenzung, Checkliste) und lässt sie vom Team bestätigen.',
    sameContent:
      '`CLAUDE.md` und `AGENTS.md` haben denselben Inhalt. Wer eine der beiden ändert, ändert beide.',

    overviewTitle: 'Projektübersicht',
    criteria: 'Kriterien',
    criteriaIntro: 'Das Team bewertet Lösungen nach diesen Kriterien:',
    moreInPlan: 'Meilensteine, Risiken, Kosten und Zeit stehen in `project-plan.md`.',
    nothingYet: 'Der Projektplan sagt dazu noch nichts.',

    architectureTitle: 'Architektur',
    diagrams: 'Diagramme',
    noDiagrams: 'Das Team hat keine Diagramme gezeichnet.',
    reasonsAt:
      'Die Entscheidungen hinter der Technik stehen mit ihrer Begründung in `decisions.md`.',

    decisionsTitle: 'Entscheidungen',
    decisionsIntro:
      'Was das Team entschieden hat, die älteste Entscheidung zuerst. Diese Entscheidungen gelten.',
    decided: 'Entschieden',
    noDecisions: 'Das Team hat noch keine Entscheidung festgehalten.',
    decision: 'Entscheidung',
    alternatives: 'Alternativen',
    decidedOn: (date, by) => (by ? `Entschieden am ${date} von ${by}.` : `Entschieden am ${date}.`),
    openDecisions: 'Offen',
    openDecisionsIntro:
      'Diese Themen hat das Team noch nicht entschieden. Bau nichts, was eines davon vorwegnimmt, ohne zu fragen.',
    reopened: (reason) => `wieder geöffnet: ${reason}`,

    codeStandardsTitle: 'Code-Standards',
    codeStandardsOpen:
      '**Noch offen.** Das Team hat keine Code-Standards festgelegt. Schlage vor dem ersten Code Standards vor, die zur Technik in `architecture.md` passen (Sprache und Strenge, Benennung, Aufbau der Ordner, Fehlerbehandlung, Tests, Commits), lass sie vom Team bestätigen und trage sie hier ein.',
    uiTitle: 'UI-Richtung',
    uiOpen:
      '**Noch offen.** Das Team hat keine Richtung für die Oberfläche festgelegt. Schlage vor dem ersten Stück Oberfläche eine Richtung vor (Stil und Stimmung, Farben, Schrift, Abstände, Bausteine, Ton der Texte), lass sie vom Team bestätigen und trage sie hier ein.',

    trackerTitle: 'Fortschritt',
    trackerIntro: (date) => `Stand: ${date}, aus Covibes exportiert. Gebaut ist noch nichts.`,
    inProgress: 'In Arbeit',
    nothing: 'Nichts.',
    milestonesAndTasks: 'Meilensteine und Aufgaben',
    notes: 'Notizen',
    notesHint: 'Hier steht nach jeder Spec, was entschieden und gelernt wurde.',

    specsTitle: 'Feature-Specs',
    specsIntro:
      'Eine Spec pro Aufgabe des Projektplans, in der Reihenfolge der Meilensteine. Jede Spec ist ein Gerüst und wird vor dem Bauen ausgearbeitet.',
    specsIntroWritten:
      'Eine Spec pro Aufgabe des Projektplans, in der Reihenfolge der Meilensteine. Eine Spec mit dem Vermerk „Gerüst“ wird vor dem Bauen ausgearbeitet; alle anderen sind ausgearbeitet.',
    skeletonMark: 'Gerüst',
    noTasks:
      'Der Projektplan nennt noch keine Aufgaben. Leite die Specs mit dem Team aus `project-plan.md` ab, bevor du baust.',
    noTasksInMilestone: 'Der Plan nennt für diesen Meilenstein keine Aufgaben.',
    milestone: (number, title) =>
      title ? `Meilenstein ${String(number)}: ${title}` : `Meilenstein ${String(number)}`,
    skeleton:
      'Gerüst aus dem Projektplan. Vor dem Bauen ausarbeiten (Ziel, Vorgehen, Abgrenzung, Checkliste) und vom Team bestätigen lassen.',
    task: 'Aufgabe',
    milestoneHeading: 'Meilenstein',
    assignee: 'Zuständig',
    context: 'Kontext',
    checklist: 'Checkliste',
    checks: [
      'Die Spec ist ausgearbeitet und vom Team bestätigt.',
      'Die Aufgabe ist umgesetzt und getestet.',
      '`context/progress-tracker.md` ist aktualisiert.',
    ],
    taskFile: 'aufgabe',
    boardFile: 'board',
  },
  en: {
    fileName: 'coding package',
    intro: (date) =>
      `The team planned this project in Covibes: scope, decisions, architecture and project plan. This package is the state of ${date}. You build the project from it, spec by spec.`,
    readFirst: 'Read before every task, in this order',
    reads: {
      overview: 'what is built and to what extent',
      architecture: 'tech, tools and diagrams',
      decisions: 'what the team decided and why',
      codeStandards: 'conventions for the code',
      ui: 'direction for the interface',
      plan: 'the complete project plan',
      tracker: 'where the project stands',
    },
    stillOpen: 'still open',
    diagramsAt: "The team's diagrams are in `docs/diagrams/` as Mermaid.",
    wayOfWorking: 'Way of working',
    rules: [
      'Work proceeds spec by spec, in the order of the files in `context/feature-specs/`. No spec, no code.',
      'The specs are a skeleton from the project plan. Work a spec out before you build it (goal, approach, out of scope, checklist) and have the team confirm it.',
      'Before starting a spec, mark it as "in progress" in `context/progress-tracker.md`. Afterwards tick its checklist and update the tracker.',
      'The decisions in `context/decisions.md` hold. If something speaks against a decision, ask the team before you build differently.',
      'If information is missing, do not guess; ask.',
    ],
    openRule:
      'What is marked as "still open" you settle with the team before the first code and write into its file.',
    writtenRule:
      'A spec that is written out you build as it stands. If it does not fit the state of the code or a decision, tell the team before you deviate. A spec marked "skeleton" you work out before you build it (goal, approach, out of scope, checklist) and have the team confirm it.',
    sameContent:
      '`CLAUDE.md` and `AGENTS.md` hold the same content. Whoever changes one of them changes both.',

    overviewTitle: 'Project overview',
    criteria: 'Criteria',
    criteriaIntro: 'The team assesses solutions by these criteria:',
    moreInPlan: 'Milestones, risks, costs and time are in `project-plan.md`.',
    nothingYet: 'The project plan says nothing about this yet.',

    architectureTitle: 'Architecture',
    diagrams: 'Diagrams',
    noDiagrams: 'The team drew no diagrams.',
    reasonsAt: 'The decisions behind the tech are in `decisions.md` with their reasoning.',

    decisionsTitle: 'Decisions',
    decisionsIntro: 'What the team decided, the oldest decision first. These decisions hold.',
    decided: 'Decided',
    noDecisions: 'The team recorded no decision yet.',
    decision: 'Decision',
    alternatives: 'Alternatives',
    decidedOn: (date, by) => (by ? `Decided on ${date} by ${by}.` : `Decided on ${date}.`),
    openDecisions: 'Open',
    openDecisionsIntro:
      'The team has not decided these topics yet. Do not build anything that anticipates one of them without asking.',
    reopened: (reason) => `reopened: ${reason}`,

    codeStandardsTitle: 'Code standards',
    codeStandardsOpen:
      '**Still open.** The team set no code standards. Before the first code, propose standards that fit the tech in `architecture.md` (language and strictness, naming, folder structure, error handling, tests, commits), have the team confirm them and write them down here.',
    uiTitle: 'UI direction',
    uiOpen:
      '**Still open.** The team set no direction for the interface. Before the first piece of interface, propose a direction (style and mood, colors, type, spacing, building blocks, tone of the texts), have the team confirm it and write it down here.',

    trackerTitle: 'Progress',
    trackerIntro: (date) => `As of ${date}, exported from Covibes. Nothing is built yet.`,
    inProgress: 'In progress',
    nothing: 'Nothing.',
    milestonesAndTasks: 'Milestones and tasks',
    notes: 'Notes',
    notesHint: 'After every spec, this is where what was decided and learned is written down.',

    specsTitle: 'Feature specs',
    specsIntro:
      'One spec per task of the project plan, in the order of the milestones. Every spec is a skeleton and is worked out before it is built.',
    specsIntroWritten:
      'One spec per task of the project plan, in the order of the milestones. A spec marked "skeleton" is worked out before it is built; all others are written out.',
    skeletonMark: 'skeleton',
    noTasks:
      'The project plan names no tasks yet. Derive the specs from `project-plan.md` with the team before you build.',
    noTasksInMilestone: 'The plan names no tasks for this milestone.',
    milestone: (number, title) =>
      title ? `Milestone ${String(number)}: ${title}` : `Milestone ${String(number)}`,
    skeleton:
      'Skeleton from the project plan. Work it out before building (goal, approach, out of scope, checklist) and have the team confirm it.',
    task: 'Task',
    milestoneHeading: 'Milestone',
    assignee: 'Assignee',
    context: 'Context',
    checklist: 'Checklist',
    checks: [
      'The spec is worked out and confirmed by the team.',
      'The task is implemented and tested.',
      '`context/progress-tracker.md` is updated.',
    ],
    taskFile: 'task',
    boardFile: 'board',
  },
};

export function codingPackageTexts(language: PlanLanguage): CodingPackageTexts {
  return TEXTS[language];
}
