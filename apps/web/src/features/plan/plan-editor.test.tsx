import { PLAN_FIELD } from '@covibes/shared';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { TooltipProvider } from '@web/components/ui/tooltip';
import type { BoardConnectionState } from '@web/features/canvas/board-connection';
import { PlanEditor } from '@web/features/plan/plan-editor';

// The collaboration server is replaced: the plan's document is a Y.Doc of the test, and the state
// of the connection is set by hand.
const collab = vi.hoisted(() => {
  const fake: { doc: unknown; state: BoardConnectionState } = {
    doc: undefined,
    state: { status: 'connected', loaded: true, denied: false },
  };
  return fake;
});
vi.mock('@web/features/canvas/use-board-doc', () => ({
  useCollabDoc: () => ({
    connection: collab.state.denied ? null : { doc: collab.doc, provider: {} },
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
