import { planSectionHint, planTemplate, type PlanNode } from '@covibes/shared';
import { Editor } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';

import { PlanSections } from '@web/features/plan/plan-sections';

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function createEditor(content: PlanNode | string, hints = true) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      PlanSections.configure(hints ? { hint: (section) => planSectionHint(section, 'de') } : {}),
    ],
    content,
  });
  editors.push(editor);
  return editor;
}

/** The section keys of the top-level headings, in order; null for a heading without one. */
function sections(editor: Editor) {
  const keys: unknown[] = [];
  editor.state.doc.forEach((node) => {
    if (node.type.name === 'heading') keys.push(node.attrs.section);
  });
  return keys;
}

/** The position right inside the top-level node at `index`. */
function inside(editor: Editor, index: number) {
  let position = 0;
  for (let before = 0; before < index; before += 1) {
    position += editor.state.doc.child(before).nodeSize;
  }
  return position + 1;
}

describe('the sections of a plan', () => {
  it('are kept with their headings, in the document and in its HTML', () => {
    const editor = createEditor(planTemplate('de'));

    expect(sections(editor)).toEqual(['scope', 'milestones', 'tech', 'risks', 'costs']);
    expect(editor.getHTML()).toContain('<h2 data-section="scope">MVP-Umfang</h2>');
    // Pasted or loaded HTML brings the key back.
    const pasted = createEditor('<h2 data-section="risks">Risiken</h2><h2>Sonstiges</h2>');
    expect(sections(pasted)).toEqual(['risks', null]);
  });

  it('stay with a heading whose text someone changes', () => {
    const editor = createEditor(planTemplate('de'));

    editor.commands.insertContentAt(inside(editor, 0), 'Unser ');

    expect(editor.state.doc.child(0).textContent).toBe('Unser MVP-Umfang');
    expect(sections(editor)[0]).toBe('scope');
  });

  it('are not inherited by a heading that splits off', () => {
    const editor = createEditor(planTemplate('de'));

    // Enter in the middle of "MVP-Umfang".
    editor
      .chain()
      .setTextSelection(inside(editor, 0) + 3)
      .splitBlock()
      .run();

    expect(editor.state.doc.child(0).textContent).toBe('MVP');
    expect(editor.state.doc.child(1).textContent).toBe('-Umfang');
    expect(sections(editor).slice(0, 3)).toEqual(['scope', null, 'milestones']);
  });

  it('belong to one heading: a second one with the same key loses it', () => {
    const editor = createEditor(planTemplate('de'));

    editor.commands.insertContentAt(editor.state.doc.content.size, {
      type: 'heading',
      attrs: { level: 2, section: 'scope' },
      content: [{ type: 'text', text: 'Kopie' }],
    });

    expect(sections(editor)).toEqual(['scope', 'milestones', 'tech', 'risks', 'costs', null]);
  });
});

describe('the hint of a section', () => {
  const hints = (editor: Editor) =>
    [...editor.view.dom.querySelectorAll('p.plan-hint')].map((paragraph) =>
      paragraph.getAttribute('data-hint'),
    );

  it('shows in the empty paragraph below the heading and is no text of the plan', () => {
    const editor = createEditor(planTemplate('de'));

    expect(hints(editor)).toHaveLength(5);
    expect(hints(editor)[0]).toBe('Was gehört zur ersten Version, und was bewusst noch nicht?');
    expect(editor.getText()).not.toContain('Was gehört');
    expect(JSON.stringify(editor.getJSON())).not.toContain('Was gehört');
  });

  it('goes with the first character and comes back when the paragraph is empty again', () => {
    const editor = createEditor(planTemplate('de'));

    editor.commands.insertContentAt(inside(editor, 1), 'Mitgliederliste');
    expect(hints(editor)).toHaveLength(4);
    expect(hints(editor)).not.toContain(planSectionHint('scope', 'de'));

    editor.commands.deleteRange({ from: inside(editor, 1), to: inside(editor, 1) + 15 });
    expect(hints(editor)).toHaveLength(5);
  });

  it('is only for the paragraph right below a section heading', () => {
    const editor = createEditor({
      type: 'doc',
      content: [
        { type: 'paragraph' },
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Frei' }] },
        { type: 'paragraph' },
        {
          type: 'heading',
          attrs: { level: 2, section: 'risks' },
          content: [{ type: 'text', text: 'Risiken' }],
        },
        { type: 'paragraph' },
        { type: 'paragraph' },
      ],
    });

    expect(hints(editor)).toEqual([planSectionHint('risks', 'de')]);
  });

  it('is left out where no hints are given', () => {
    const editor = createEditor(planTemplate('de'), false);

    expect(hints(editor)).toEqual([]);
    expect(sections(editor)).toHaveLength(5);
  });
});

describe('typing', () => {
  /** Types text at the caret the way the browser hands it to the editor. */
  function type(editor: Editor, text: string) {
    for (const character of text) {
      const { from, to } = editor.state.selection;
      const handled = editor.view.someProp('handleTextInput', (handle) =>
        handle(editor.view, from, to, character, () => editor.state.tr.insertText(character)),
      );
      if (!handled) editor.commands.insertContent(character);
    }
  }

  it('turns "## " into a heading and "- " into a list, as in Markdown', () => {
    const editor = createEditor({ type: 'doc', content: [{ type: 'paragraph' }] });

    editor.commands.setTextSelection(1);
    type(editor, '## Ziele');
    expect(editor.getJSON().content[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Ziele' }],
    });

    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'paragraph' });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    type(editor, '- Erster Punkt');
    expect(editor.getJSON().content.map((node) => node.type)).toContain('bulletList');
    expect(editor.getText()).toContain('Erster Punkt');
  });
});
