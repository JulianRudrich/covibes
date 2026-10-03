import { NO_USER_ID, PLAN_TASK_ATTRIBUTE, type RoadmapAssignee } from '@covibes/shared';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Extension } from '@tiptap/react';

import { initialsOf } from '@web/lib/format';

/** How the id of a task shows in HTML, e.g. when a list is copied and pasted. */
const HTML_ATTRIBUTE = 'data-task-id';

export const planTasksKey = new PluginKey('planTasks');

/** What the plan shows at its tasks; the editor's owner keeps it up to date (`setPlanTasks`). */
export type PlanTasksState = {
  /** The tasks of the plan by their id, with who took them; null: nobody. */
  assignees: ReadonlyMap<string, RoadmapAssignee | null>;
  /** Owners and editors get a button to assign; null for those who only read. */
  onPick: ((taskId: string, anchor: HTMLElement) => void) | null;
  /** The texts of the controls, in the language of the app. */
  labels: { assign: string; assignedTo: (name: string) => string; teamMember: string };
};

/** Nothing to show: the state of an editor before its owner said what its tasks are. */
export const NO_PLAN_TASKS: PlanTasksState = {
  assignees: new Map(),
  onPick: null,
  labels: { assign: '', assignedTo: (name) => name, teamMember: '' },
};

export type PlanTasksOptions = {
  /**
   * Gives what the editor shows at its tasks, whenever it draws them. Its owner changes what this
   * gives and then dispatches a transaction with `planTasksKey` as meta, so the controls are drawn
   * anew. A function, since Tiptap copies the objects among its options.
   */
  read: () => PlanTasksState;
};

/** The control at the end of a task: who took it, or the button to assign it. */
function control(taskId: string, state: PlanTasksState): HTMLElement | null {
  const assignee = state.assignees.get(taskId) ?? null;
  const { onPick, labels } = state;
  if (!assignee && !onPick) return null;

  const element = document.createElement(onPick ? 'button' : 'span');
  element.className = assignee ? 'plan-task plan-task-assigned' : 'plan-task plan-task-open';
  element.setAttribute('contenteditable', 'false');
  if (assignee) {
    const anonymous = assignee.userId === NO_USER_ID || assignee.name === '';
    const name = anonymous ? labels.teamMember : assignee.name;
    const avatar = document.createElement('span');
    avatar.className = 'plan-task-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = anonymous ? '·' : initialsOf(assignee.name);
    const label = document.createElement('span');
    label.textContent = name;
    element.append(avatar, label);
    element.setAttribute('aria-label', labels.assignedTo(name));
  } else {
    element.textContent = labels.assign;
  }
  if (element instanceof HTMLButtonElement && onPick) {
    element.type = 'button';
    // The caret stays where it is; the click only opens the menu.
    element.addEventListener('mousedown', (event) => {
      event.preventDefault();
    });
    element.addEventListener('click', (event) => {
      event.preventDefault();
      onPick(taskId, element);
    });
  }
  return element;
}

/** Where the control of a task goes: the end of the first paragraph of its list item. */
function controlPosition(item: Node, position: number): number | null {
  const first = item.firstChild;
  return first?.type.name === 'paragraph' ? position + first.nodeSize : null;
}

/**
 * Tasks in the plan (spec 26b). A list item keeps the id the server gave it: the attribute stays
 * on the item while its text changes, and a new item made by splitting one does not inherit it.
 * Every task the roadmap knows shows who took it at the end of its line, or the button to assign.
 */
export const PlanTasks = Extension.create<PlanTasksOptions>({
  name: 'planTasks',

  addOptions() {
    return { read: () => NO_PLAN_TASKS };
  },

  addGlobalAttributes() {
    return [
      {
        types: ['listItem'],
        attributes: {
          [PLAN_TASK_ATTRIBUTE]: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => element.getAttribute(HTML_ATTRIBUTE),
            renderHTML: (attributes) => {
              const id: unknown = attributes[PLAN_TASK_ATTRIBUTE];
              return typeof id === 'string' ? { [HTML_ATTRIBUTE]: id } : {};
            },
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const { read } = this.options;
    return [
      new Plugin({
        key: planTasksKey,
        props: {
          decorations: (editorState) => {
            const state = read();
            if (state.assignees.size === 0) return null;
            const decorations: Decoration[] = [];
            editorState.doc.descendants((node, position) => {
              if (node.type.name !== 'listItem') return true;
              const id: unknown = node.attrs[PLAN_TASK_ATTRIBUTE];
              if (typeof id !== 'string' || !state.assignees.has(id)) return true;
              const at = controlPosition(node, position);
              if (at === null) return true;
              const assignee = state.assignees.get(id) ?? null;
              // Nobody on it and nobody to assign it: nothing to show.
              if (!assignee && !state.onPick) return true;
              decorations.push(
                Decoration.widget(at, () => control(id, state) ?? document.createTextNode(''), {
                  side: 1,
                  // A control is built anew when what it shows changes.
                  key: `${id}:${assignee?.userId ?? ''}:${assignee?.name ?? ''}:${state.onPick ? 'pick' : 'read'}`,
                  ignoreSelection: true,
                  stopEvent: () => true,
                }),
              );
              return true;
            });
            return DecorationSet.create(editorState.doc, decorations);
          },
        },
      }),
    ];
  },
});
