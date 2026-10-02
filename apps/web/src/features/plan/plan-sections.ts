import { PLAN_SECTION_ATTRIBUTE, PLAN_SECTIONS, type PlanSection } from '@covibes/shared';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Extension } from '@tiptap/react';
import { ySyncPluginKey } from '@tiptap/y-tiptap';

/** How the section of a heading shows in HTML, e.g. when a plan is copied and pasted. */
const HTML_ATTRIBUTE = 'data-section';

function isSection(value: unknown): value is PlanSection {
  return typeof value === 'string' && (PLAN_SECTIONS as readonly string[]).includes(value);
}

export type PlanSectionsOptions = {
  /** What belongs in a section, shown while the section is still empty; none without it. */
  hint?: (section: PlanSection) => string;
};

/**
 * Marks the headings that start a section of the plan (spec 25a): a heading carries the key of
 * its section in an attribute, so later parts find the section whatever the heading says.
 *
 * - A key belongs to one heading. A new heading made by splitting one does not inherit it, and a
 *   second heading that arrives with the same key, e.g. by pasting a copied section, loses it.
 * - An empty paragraph right below a section heading shows a hint on what belongs there. The hint
 *   is no text of the document: it goes with the first character and is never stored.
 */
export const PlanSections = Extension.create<PlanSectionsOptions>({
  name: 'planSections',

  addOptions() {
    return {};
  },

  addGlobalAttributes() {
    return [
      {
        types: ['heading'],
        attributes: {
          [PLAN_SECTION_ATTRIBUTE]: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute(HTML_ATTRIBUTE),
            renderHTML: (attributes) => {
              const section: unknown = attributes[PLAN_SECTION_ATTRIBUTE];
              return typeof section === 'string' ? { [HTML_ATTRIBUTE]: section } : {};
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const { hint } = this.options;
    return [
      new Plugin({
        key: new PluginKey('planSections'),
        appendTransaction: (transactions, _oldState, state) => {
          // Only what this person changed: what others did is tidied where they did it.
          const local = transactions.some((transaction) => {
            const sync = transaction.getMeta(ySyncPluginKey) as
              { isChangeOrigin?: boolean } | undefined;
            return transaction.docChanged && sync?.isChangeOrigin !== true;
          });
          if (!local) return null;

          const seen = new Set<string>();
          const transaction = state.tr;
          state.doc.forEach((node, position) => {
            const section: unknown = node.attrs[PLAN_SECTION_ATTRIBUTE];
            if (node.type.name !== 'heading' || typeof section !== 'string') return;
            if (seen.has(section)) {
              transaction.setNodeAttribute(position, PLAN_SECTION_ATTRIBUTE, null);
            }
            seen.add(section);
          });
          return transaction.docChanged ? transaction : null;
        },
        props: {
          decorations: (state) => {
            if (!hint) return null;
            const decorations: Decoration[] = [];
            let heading: PlanSection | null = null;
            state.doc.forEach((node, position) => {
              if (heading && node.type.name === 'paragraph' && node.content.size === 0) {
                decorations.push(
                  Decoration.node(position, position + node.nodeSize, {
                    class: 'plan-hint',
                    'data-hint': hint(heading),
                  }),
                );
              }
              const section: unknown = node.attrs[PLAN_SECTION_ATTRIBUTE];
              heading = node.type.name === 'heading' && isSection(section) ? section : null;
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
