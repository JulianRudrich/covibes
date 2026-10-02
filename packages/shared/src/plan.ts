import { z } from 'zod';

// The project plan (spec 25a): one shared document per project, written with Tiptap on a Y.Doc.

/** The sections of a plan, in their order (`project-overview.md`, "Project plan and export"). */
export const PLAN_SECTIONS = ['scope', 'milestones', 'tech', 'risks', 'costs'] as const;
export type PlanSection = (typeof PLAN_SECTIONS)[number];

/** The languages a plan is written in: the project's language. */
export type PlanLanguage = 'de' | 'en';

/**
 * The Y.XmlFragment of the plan's Y.Doc that holds the document; Tiptap's collaboration extension
 * uses this name unless told otherwise.
 */
export const PLAN_FIELD = 'default';

/**
 * A section starts at its heading: a heading of level 2 that carries the section's key in this
 * attribute. People may reword the heading; the key stays, so later parts find the section.
 */
export const PLAN_SECTION_ATTRIBUTE = 'section';
export const PLAN_SECTION_LEVEL = 2;

/** The name of a project's plan document on the collaboration server. */
export function planDocumentName(projectId: string): string {
  return `plan:${projectId}`;
}

/** The project id inside the name of a plan document, or undefined for anything else. */
export function projectIdFromPlanDocumentName(name: string): string | undefined {
  if (!name.startsWith('plan:')) return undefined;
  const id = z.uuid().safeParse(name.slice('plan:'.length));
  return id.success ? id.data : undefined;
}

const SECTION_TEXTS: Readonly<
  Record<PlanLanguage, Record<PlanSection, { title: string; hint: string }>>
> = {
  de: {
    scope: {
      title: 'MVP-Umfang',
      hint: 'Was gehört zur ersten Version, und was bewusst noch nicht?',
    },
    milestones: {
      title: 'Meilensteine und Aufgaben',
      hint: 'In welchen Schritten entsteht das Projekt, und was ist in jedem Schritt zu tun?',
    },
    tech: {
      title: 'Tech-Empfehlung',
      hint: 'Womit wird gebaut, und welche Entscheidungen begründen das?',
    },
    risks: {
      title: 'Risiken',
      hint: 'Was kann schiefgehen, und wie geht ihr damit um?',
    },
    costs: {
      title: 'Kosten und Zeit',
      hint: 'Was kostet das Projekt, und wie lange dauert es?',
    },
  },
  en: {
    scope: {
      title: 'MVP scope',
      hint: 'What belongs to the first version, and what is left out on purpose?',
    },
    milestones: {
      title: 'Milestones and tasks',
      hint: 'In which steps does the project come to life, and what is to do in each step?',
    },
    tech: {
      title: 'Tech recommendation',
      hint: 'What is it built with, and which decisions justify that?',
    },
    risks: {
      title: 'Risks',
      hint: 'What can go wrong, and how do you deal with it?',
    },
    costs: {
      title: 'Costs and time',
      hint: 'What does the project cost, and how long does it take?',
    },
  },
};

/** The heading of a section in the project's language. */
export function planSectionTitle(section: PlanSection, language: PlanLanguage): string {
  return SECTION_TEXTS[language][section].title;
}

/** A node of the plan as ProseMirror JSON, the format Tiptap reads and writes. */
export type PlanNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PlanNode[];
  text?: string;
  marks?: { type: string }[];
};

/** What belongs in a section, in the project's language; the editor shows it while it is empty. */
export function planSectionHint(section: PlanSection, language: PlanLanguage): string {
  return SECTION_TEXTS[language][section].hint;
}

/**
 * The template of a new plan: the five section headings in the project's language, each followed
 * by an empty paragraph to write in.
 */
export function planTemplate(language: PlanLanguage): PlanNode {
  return {
    type: 'doc',
    content: PLAN_SECTIONS.flatMap((section): PlanNode[] => {
      const { title } = SECTION_TEXTS[language][section];
      return [
        {
          type: 'heading',
          attrs: { level: PLAN_SECTION_LEVEL, [PLAN_SECTION_ATTRIBUTE]: section },
          content: [{ type: 'text', text: title }],
        },
        { type: 'paragraph' },
      ];
    }),
  };
}
