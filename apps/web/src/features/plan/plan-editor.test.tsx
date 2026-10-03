import {
  PLAN_FIELD,
  PLAN_TASK_ATTRIBUTE,
  planNodesFromMarkdown,
  writePlanSection,
  type PlanNode,
} from '@covibes/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { TooltipProvider } from '@web/components/ui/tooltip';
import type { BoardConnectionState } from '@web/features/canvas/board-connection';
import { PlanEditor } from '@web/features/plan/plan-editor';

// The collaboration server is replaced: the plan's document is a Y.Doc of the test, and the state
// of the connection is set by hand.
const collab = vi.hoisted(() => {
  const fake: { doc: unknown; connection: unknown; state: BoardConnectionState } = {
    doc: undefined,
    connection: undefined,
    state: { status: 'connected', loaded: true, denied: false },
  };
  return fake;
});
vi.mock('@web/features/canvas/use-board-doc', () => ({
  useCollabDoc: () => ({
    // One connection per test, as the app keeps one per plan: the editor lives as long as it.
    connection: collab.state.denied ? null : collab.connection,
    ...collab.state,
  }),
}));
// The carets of other people need the awareness of a live connection.
vi.mock('@tiptap/extension-collaboration-caret', async () => {
  const { Extension } = await import('@tiptap/react');
  return { CollaborationCaret: Extension.create({ name: 'collaborationCaret' }) };
});

const PROJECT = '0b6a0b52-8f55-4c4e-9f6b-4ad2b3b3c0de';
const OLGA = { id: '11111111-1111-4111-8111-111111111111', name: 'Olga' };

beforeEach(() => {
  collab.doc = new Y.Doc();
  collab.connection = { doc: collab.doc, provider: {} };
  collab.state = { status: 'connected', loaded: true, denied: false };
  // jsdom lays nothing out; ProseMirror asks for the place of the caret when it gets the focus.
  const noRects = () => [] as unknown as DOMRectList;
  Range.prototype.getClientRects = noRects;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Element.prototype.scrollIntoView = () => undefined;
});

function renderPlan(props: Partial<Parameters<typeof PlanEditor>[0]> = {}) {
  return render(
    <TooltipProvider>
      <PlanEditor projectId={PROJECT} user={OLGA} readOnly={false} language="de" {...props} />
    </TooltipProvider>,
  );
}

/** What the shared document holds, as the collaboration server would store it. */
function stored() {
  return (collab.doc as Y.Doc).getXmlFragment(PLAN_FIELD).toJSON();
}

describe('PlanEditor', () => {
  it('starts empty and writes the five sections from the template', async () => {
    renderPlan();

    const document = await screen.findByRole('textbox', { name: 'Projektplan' });
    expect(document).toHaveAttribute('contenteditable', 'true');
    expect(screen.getByText('Der Plan ist noch leer')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mit Vorlage beginnen' }));

    await waitFor(() => {
      expect(screen.queryByText('Der Plan ist noch leer')).not.toBeInTheDocument();
    });
    expect(
      within(document)
        .getAllByRole('heading', { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([
      'MVP-Umfang',
      'Meilensteine und Aufgaben',
      'Tech-Empfehlung',
      'Risiken',
      'Kosten und Zeit',
    ]);
    // The hints show below the headings and are not stored.
    expect(document.querySelectorAll('p.plan-hint')).toHaveLength(5);
    expect(stored()).toContain('<heading level="2" section="scope">MVP-Umfang</heading>');
    expect(stored()).not.toContain('Was gehört');
  });

  it("writes the template in the project's language", async () => {
    renderPlan({ language: 'en' });
    const document = await screen.findByRole('textbox', { name: 'Projektplan' });

    fireEvent.click(screen.getByRole('button', { name: 'Mit Vorlage beginnen' }));

    await waitFor(() => {
      expect(within(document).getAllByRole('heading', { level: 2 })[0]).toHaveTextContent(
        'MVP scope',
      );
    });
    expect(document.querySelector('p.plan-hint')).toHaveAttribute(
      'data-hint',
      'What belongs to the first version, and what is left out on purpose?',
    );
  });

  it('shows what others wrote and formats with the toolbar', async () => {
    renderPlan();
    const document = await screen.findByRole('textbox', { name: 'Projektplan' });
    fireEvent.click(screen.getByRole('button', { name: 'Mit Vorlage beginnen' }));
    await within(document).findAllByRole('heading', { level: 2 });

    // Someone else writes into the shared document.
    act(() => {
      const paragraph = new Y.XmlElement('paragraph');
      paragraph.insert(0, [new Y.XmlText('Von Sam geschrieben')]);
      (collab.doc as Y.Doc).getXmlFragment(PLAN_FIELD).push([paragraph]);
    });
    expect(await within(document).findByText('Von Sam geschrieben')).toBeInTheDocument();

    const toolbar = screen.getByRole('toolbar', { name: 'Formatierung' });
    expect(
      within(toolbar)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label')),
    ).toEqual([
      'Überschrift',
      'Zwischenüberschrift',
      'Fett',
      'Kursiv',
      'Aufzählung',
      'Nummerierte Liste',
      'Rückgängig',
      'Wiederholen',
    ]);
    // The caret is below the first heading after the template: no heading is active there.
    expect(within(toolbar).getByRole('button', { name: 'Überschrift' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(within(toolbar).getByRole('button', { name: 'Rückgängig' })).toBeEnabled();
    expect(within(toolbar).getByRole('button', { name: 'Wiederholen' })).toBeDisabled();

    fireEvent.click(within(toolbar).getByRole('button', { name: 'Aufzählung' }));
    await waitFor(() => {
      expect(within(document).getByRole('list')).toBeInTheDocument();
    });
    expect(within(toolbar).getByRole('button', { name: 'Aufzählung' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Undo takes back the own change, not what the other person wrote.
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Rückgängig' }));
    await waitFor(() => {
      expect(within(document).queryByRole('list')).not.toBeInTheDocument();
    });
    expect(within(document).getByText('Von Sam geschrieben')).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: 'Wiederholen' })).toBeEnabled();
  });

  it('is read-only for viewers: no toolbar, no template', async () => {
    renderPlan({ readOnly: true });

    const document = await screen.findByRole('textbox', { name: 'Projektplan' });
    expect(document).toHaveAttribute('contenteditable', 'false');
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.getByText('Der Plan ist noch leer')).toBeInTheDocument();
    expect(screen.getByText('Sobald das Team schreibt, erscheint der Plan hier.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Mit Vorlage beginnen' })).not.toBeInTheDocument();
  });

  it('says so while the plan loads, when it is refused and while the connection is down', async () => {
    collab.state = { status: 'connecting', loaded: false, denied: false };
    const loading = renderPlan();
    expect(screen.getByText('Plan wird geladen …')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    loading.unmount();

    collab.state = { status: 'disconnected', loaded: false, denied: true };
    const denied = renderPlan();
    expect(screen.getByText('Du hast keinen Zugriff mehr auf diesen Plan.')).toBeInTheDocument();
    denied.unmount();

    collab.state = { status: 'disconnected', loaded: true, denied: false };
    renderPlan();
    expect(await screen.findByRole('textbox', { name: 'Projektplan' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Verbindung wird wiederhergestellt …');
  });

  it('offers "Plan erzeugen" in the toolbar and in the empty plan (spec 25b)', async () => {
    const onGenerate = vi.fn();
    renderPlan({ generation: { busy: false, onGenerate } });
    await screen.findByRole('textbox', { name: 'Projektplan' });

    expect(screen.getByText(/lasst den Moderator einen ersten Entwurf/)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Plan erzeugen' });
    expect(buttons).toHaveLength(2);
    for (const button of buttons) fireEvent.click(button);
    expect(onGenerate).toHaveBeenCalledTimes(2);
  });

  it('rests while the moderator writes or its suggestions wait, and shows them above the plan', async () => {
    const onGenerate = vi.fn();
    renderPlan({
      generation: { busy: true, onGenerate },
      above: () => <p>Der Moderator schreibt den Plan …</p>,
    });
    const document = await screen.findByRole('textbox', { name: 'Projektplan' });

    const note = screen.getByText('Der Moderator schreibt den Plan …');
    expect(note.compareDocumentPosition(document) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // An empty plan needs no start help while a draft is on its way.
    expect(screen.queryByText('Der Plan ist noch leer')).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'Plan erzeugen' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onGenerate).not.toHaveBeenCalled();
  });

  it('does not offer a generation to viewers', async () => {
    renderPlan({ readOnly: true });
    await screen.findByRole('textbox', { name: 'Projektplan' });

    expect(screen.queryByRole('button', { name: 'Plan erzeugen' })).not.toBeInTheDocument();
  });

  it('hands the plan as it stands to what shows above it and at the toolbar (spec 25c)', async () => {
    renderPlan({
      above: (plan) => <p>Abschnitte: {Object.keys(plan.sections).join(', ')}</p>,
      toolbarEnd: (plan) => <span>Knoten: {plan.nodes.length}</span>,
    });
    await screen.findByRole('textbox', { name: 'Projektplan' });
    expect(screen.getByText('Knoten: 0')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Mit Vorlage beginnen' }));

    // The comparison follows the document a moment after it changed.
    expect(await screen.findByText('Knoten: 10')).toBeInTheDocument();
    expect(screen.getByText('Abschnitte: scope, milestones, tech, risks, costs')).toBeVisible();
    // It sits in the toolbar, before the place of "Plan erzeugen".
    expect(
      within(screen.getByRole('toolbar', { name: 'Formatierung' })).getByText('Knoten: 10'),
    ).toBeInTheDocument();
  });

  it('gives viewers what stands at the toolbar without the toolbar', async () => {
    renderPlan({ readOnly: true, toolbarEnd: () => <button type="button">Versionen</button> });
    await screen.findByRole('textbox', { name: 'Projektplan' });

    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Versionen' })).toBeInTheDocument();
  });
});

describe('tasks in the plan (spec 26b)', () => {
  const LOGIN = '7a000000-0000-4000-8000-000000000001';
  const EXPORT = '7a000000-0000-4000-8000-000000000002';
  const NOTE = '7a000000-0000-4000-8000-000000000003';
  const ALEX = { userId: '22222222-2222-4222-8222-222222222222', name: 'Alex Berg' };
  const SAM = { userId: '33333333-3333-4333-8333-333333333333', name: 'Sam Lee' };

  /** A plan whose milestone has two tasks and a note, each list item with its id. */
  function writeTasks() {
    const ids = [LOGIN, EXPORT, NOTE];
    const withIds = (nodes: PlanNode[]): PlanNode[] =>
      nodes.map((node) => ({
        ...node,
        ...(node.type === 'listItem' ? { attrs: { [PLAN_TASK_ATTRIBUTE]: ids.shift() } } : {}),
        ...(node.content ? { content: withIds(node.content) } : {}),
      }));
    writePlanSection(
      collab.doc as Y.Doc,
      'milestones',
      withIds(
        planNodesFromMarkdown('### Meilenstein 1: Grundgerüst\n\n- Login bauen\n- Export\n- Notiz'),
      ),
      'de',
    );
  }

  const items = (document: HTMLElement) =>
    [...document.querySelectorAll('li')].map((item) => item.textContent);

  it('shows who took a task and offers to assign the others', async () => {
    writeTasks();
    renderPlan({
      tasks: {
        // The note is no task of the roadmap, so nothing shows at it.
        assignees: new Map([
          [LOGIN, ALEX],
          [EXPORT, null],
        ]),
        assigning: { members: [ALEX, SAM], onAssign: vi.fn() },
      },
    });
    const document = await screen.findByRole('textbox', { name: 'Projektplan' });

    await waitFor(() => {
      expect(items(document)).toEqual(['Login bauenABAlex Berg', 'ExportZuweisen', 'Notiz']);
    });
    const taken = within(document).getByRole('button', { name: 'Zugewiesen an Alex Berg' });
    expect(taken).toHaveClass('plan-task-assigned');
    expect(taken).toHaveAttribute('contenteditable', 'false');
    expect(within(document).getByRole('button', { name: 'Zuweisen' })).toHaveClass(
      'plan-task-open',
    );
    // The controls are no text of the plan.
    expect(stored()).not.toContain('Alex Berg');
    expect(stored()).not.toContain('Zuweisen');
  });

  it('opens the members from a task and assigns the one chosen', async () => {
    writeTasks();
    const onAssign = vi.fn();
    renderPlan({
      tasks: {
        assignees: new Map([
          [LOGIN, ALEX],
          [EXPORT, null],
        ]),
        assigning: { members: [ALEX, SAM], onAssign },
      },
    });
    const document = await screen.findByRole('textbox', { name: 'Projektplan' });

    fireEvent.click(await within(document).findByRole('button', { name: 'Zuweisen' }));
    const menu = await screen.findByRole('menu');
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['ABAlex Berg', 'SLSam Lee', 'Niemand']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Sam Lee' }));

    expect(onAssign).toHaveBeenCalledExactlyOnceWith(EXPORT, SAM);
    await waitFor(() => {
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    // The one who has the task again changes nothing; "Niemand" clears it.
    fireEvent.click(within(document).getByRole('button', { name: 'Zugewiesen an Alex Berg' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Alex Berg' }));
    expect(onAssign).toHaveBeenCalledTimes(1);
    fireEvent.click(within(document).getByRole('button', { name: 'Zugewiesen an Alex Berg' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Niemand' }));
    expect(onAssign).toHaveBeenLastCalledWith(LOGIN, null);
  });

  it('shows viewers who took a task, without a way to change it', async () => {
    writeTasks();
    renderPlan({
      readOnly: true,
      tasks: {
        assignees: new Map([
          [LOGIN, ALEX],
          [EXPORT, null],
        ]),
      },
    });
    const document = await screen.findByRole('textbox', { name: 'Projektplan' });

    await waitFor(() => {
      expect(items(document)).toEqual(['Login bauenABAlex Berg', 'Export', 'Notiz']);
    });
    expect(within(document).queryByRole('button')).not.toBeInTheDocument();
    expect(document.querySelector('span.plan-task-assigned')).toHaveAttribute(
      'aria-label',
      'Zugewiesen an Alex Berg',
    );
  });

  it('follows when the assignee changes', async () => {
    writeTasks();
    const tasks = (assignee: typeof ALEX | null) => ({
      assignees: new Map([[LOGIN, assignee]]),
      assigning: { members: [ALEX, SAM], onAssign: vi.fn() },
    });
    const view = renderPlan({ tasks: tasks(ALEX) });
    const document = await screen.findByRole('textbox', { name: 'Projektplan' });
    await within(document).findByRole('button', { name: 'Zugewiesen an Alex Berg' });

    view.rerender(
      <TooltipProvider>
        <PlanEditor
          projectId={PROJECT}
          user={OLGA}
          readOnly={false}
          language="de"
          tasks={tasks(SAM)}
        />
      </TooltipProvider>,
    );

    expect(
      await within(document).findByRole('button', { name: 'Zugewiesen an Sam Lee' }),
    ).toBeInTheDocument();
    expect(within(document).queryByRole('button', { name: /Alex Berg/ })).not.toBeInTheDocument();
  });

  it('keeps the id on its task while it is edited; a task split off it has none', async () => {
    writeTasks();
    renderPlan();
    const document = await screen.findByRole('textbox', { name: 'Projektplan' });
    await within(document).findByText('Login bauen');
    const { editor } = document as unknown as {
      editor: {
        state: { doc: { descendants: (visit: (node: PmNode, position: number) => void) => void } };
        chain: () => {
          setTextSelection: (position: number) => {
            insertContent: (text: string) => {
              splitListItem: (type: string) => { run: () => boolean };
            };
          };
        };
      };
    };
    type PmNode = { type: { name: string }; textContent: string; nodeSize: number };
    let end = 0;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === 'paragraph' && node.textContent === 'Login bauen') {
        end = position + node.nodeSize - 1;
      }
    });

    act(() => {
      editor
        .chain()
        .setTextSelection(end)
        .insertContent(' und testen')
        .splitListItem('listItem')
        .run();
    });

    await waitFor(() => {
      expect(items(document)).toEqual(['Login bauen und testen', '', 'Export', 'Notiz']);
    });
    expect(stored()).toContain(`<listitem taskId="${LOGIN}"><paragraph>Login bauen und testen`);
    // One list item carries the id, and the new one carries none.
    expect(stored().split(`taskId="${LOGIN}"`)).toHaveLength(2);
    expect(stored().match(/taskId=/g)).toHaveLength(3);
  });
});
