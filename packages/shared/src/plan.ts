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

/**
 * A task is a list item of the plan (spec 26b). It carries its id in this attribute, so its
 * assignment stays with it whatever its text becomes. The server gives the ids.
 */
export const PLAN_TASK_ATTRIBUTE = 'taskId';

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

export const planNodeSchema: z.ZodType<PlanNode> = z.lazy(() =>
  z.object({
    type: z.string().min(1).max(40),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(planNodeSchema).optional(),
    text: z.string().optional(),
    marks: z.array(z.object({ type: z.string().min(1).max(40) })).optional(),
  }),
);

/**
 * The moderator's suggestion for one section of the plan (spec 25b): the text that replaces what
 * the section holds once someone accepts it.
 */
export const planSuggestionSchema = z.object({
  id: z.uuid(),
  section: z.enum(PLAN_SECTIONS),
  content: z.array(planNodeSchema),
  createdAt: z.string(),
  /** From a generation of the whole plan, or from an update after something changed (spec 25c). */
  kind: z.enum(['generate', 'update']).default('generate'),
  /** People changed the section by hand since the moderator last wrote it. */
  handEdited: z.boolean().default(false),
});
export type PlanSuggestion = z.infer<typeof planSuggestionSchema>;

/**
 * `GET /api/projects/:projectId/plan`: what waits around the plan. `failure` says that the latest
 * generation gave nothing: `quota` when the provider's quota was used up (with the time it is
 * free again, if known), `failed` for anything else.
 */
export type PlanState = {
  /** The open suggestions, in the order of the sections. */
  suggestions: PlanSuggestion[];
  /** The moderator is writing the plan right now. */
  generating: boolean;
  failure: { kind: 'quota' | 'failed'; resetsAt: string | null } | null;
  /**
   * Decisions or criteria changed since the moderator last wrote or updated the plan (spec 25c):
   * what changed, the newest first, and how many more changes there are. Null while the plan is
   * current or was never generated.
   */
  outdated: { changes: PlanChange[]; more: number } | null;
  /** The latest update found nothing to change; shown until something else happens. */
  upToDate: boolean;
};

/** A change of the project the plan does not know yet. */
export type PlanChange = {
  kind: 'decided' | 'reopened' | 'criteria';
  /** The topic of the decision; null for a change of the criteria. */
  topic: string | null;
};

/** Why a version of the plan was kept (spec 25c). */
export const PLAN_VERSION_REASONS = ['generated', 'updated', 'manual'] as const;
export type PlanVersionReason = (typeof PLAN_VERSION_REASONS)[number];

/**
 * A version of the plan (`GET /api/projects/:projectId/plan/versions`, newest first): `generated`
 * and `updated` once the suggestions of a generation or update were decided, `manual` for the
 * state before the first suggestion was written into a plan people had changed by hand.
 */
export const planVersionSchema = z.object({
  id: z.uuid(),
  number: z.number().int().positive(),
  reason: z.enum(PLAN_VERSION_REASONS),
  createdAt: z.string(),
  /** Who accepted the suggestion that led to the version; null once the account is gone. */
  createdBy: z.string().nullable(),
});
export type PlanVersion = z.infer<typeof planVersionSchema>;

/** `GET …/plan/versions/:versionId`: a version with the plan as it stood. */
export type PlanVersionContent = PlanVersion & { content: PlanNode[] };

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
