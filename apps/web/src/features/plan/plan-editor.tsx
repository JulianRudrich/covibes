import {
  PLAN_FIELD,
  planDocumentName,
  planSectionHint,
  planTemplate,
  type AwarenessUser,
  type PlanLanguage,
} from '@covibes/shared';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import { TextSelection } from '@tiptap/pm/state';
import { EditorContent, useEditor, useEditorState } from '@tiptap/react';
import { StarterKit } from '@tiptap/starter-kit';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@web/components/ui/button';
import type { BoardConnection } from '@web/features/canvas/board-connection';
import { Sparkle } from '@web/features/canvas/node-chrome';
import { useCollabDoc } from '@web/features/canvas/use-board-doc';
import { PlanSections } from '@web/features/plan/plan-sections';
import { PlanToolbar } from '@web/features/plan/plan-toolbar';

type PlanEditorProps = {
  projectId: string;
  user: AwarenessUser;
  /** Viewers read the plan but cannot change it. */
  readOnly: boolean;
  /** The project's language, in which the template is written. */
  language: PlanLanguage;
  /** Shown above the document, e.g. the moderator's suggestions (spec 25b). */
  above?: ReactNode;
  /**
   * "Plan erzeugen" (spec 25b), for owners and editors. `busy` says that the moderator writes or
   * that its suggestions wait; then the button rests and an empty plan needs no start help.
   */
  generation?: { busy: boolean; onGenerate: () => void };
};

/** The caret of another person: a line in the human color with their name above it. */
function renderCaret(user: Record<string, unknown>): HTMLElement {
  const caret = document.createElement('span');
  caret.className = 'plan-caret';
  const label = document.createElement('span');
  label.className = 'plan-caret-label';
  label.textContent = typeof user.name === 'string' ? user.name : '';
  caret.append(label);
  return caret;
}

function Message({ children }: { children: string }) {
  return (
    <div className="grid h-full place-items-center p-6 text-center text-ui text-text-3">
      {children}
    </div>
  );
}

/**
 * The plan of a project as a shared document (spec 25a): Tiptap on the plan's Y.Doc, connected
 * like a board. It loads the document, says so when the server refuses it, and shows the hint of
 * the canvas while the connection is interrupted.
 */
export function PlanEditor({ projectId, ...plan }: PlanEditorProps) {
  const { t } = useTranslation();
  const { connection, status, loaded, denied } = useCollabDoc(planDocumentName(projectId));

  if (denied) return <Message>{t('plan.denied')}</Message>;
  if (!connection || !loaded) return <Message>{t('plan.loading')}</Message>;
  return (
    <>
      <PlanDocument key={projectId} connection={connection} {...plan} />
      {status !== 'connected' ? (
        <div
          role="status"
          className="absolute top-3 left-1/2 z-10 flex h-[26px] -translate-x-1/2 items-center gap-2 rounded-[13px] bg-bg-muted px-3 text-status text-text-2 shadow-float"
        >
          <span className="size-1.5 animate-pulse rounded-full bg-text-3" aria-hidden="true" />
          {t('canvas.reconnecting')}
        </div>
      ) : null}
    </>
  );
}

function PlanDocument({
  connection,
  user,
  readOnly,
  language,
  above,
  generation,
}: Omit<PlanEditorProps, 'projectId'> & { connection: BoardConnection }) {
  const { t } = useTranslation();
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          // Undo follows the shared document, so it takes back one's own changes only.
          undoRedo: false,
          heading: { levels: [2, 3] },
          blockquote: false,
          code: false,
          codeBlock: false,
          horizontalRule: false,
          link: false,
          strike: false,
          underline: false,
        }),
        PlanSections.configure({ hint: (section) => planSectionHint(section, language) }),
        Collaboration.configure({ document: connection.doc, field: PLAN_FIELD }),
        CollaborationCaret.configure({
          provider: connection.provider,
          user: { id: user.id, name: user.name },
          render: renderCaret,
          selectionRender: () => ({ class: 'plan-selection' }),
        }),
      ],
      editable: !readOnly,
      editorProps: {
        attributes: {
          class: 'plan-doc',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': t('plan.label'),
        },
      },
    },
    [connection, language],
  );

  useEffect(() => {
    editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  const empty = useEditorState({ editor, selector: ({ editor: current }) => current.isEmpty });

  return (
    <div className="flex h-full min-h-0 flex-col">
      {readOnly ? null : (
        <PlanToolbar
          editor={editor}
          end={
            generation ? (
              <Button size="s" disabled={generation.busy} onClick={generation.onGenerate}>
                <Sparkle />
                {t('plan.generate')}
              </Button>
            ) : null
          }
        />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-10 py-8">
          {above}
          {empty && !generation?.busy ? (
            <div className="flex flex-col items-start gap-2.5 rounded-card border border-border bg-bg-subtle p-4">
              <div className="text-ui font-semibold text-text">{t('plan.empty.title')}</div>
              <p className="m-0 text-body leading-normal text-text-body">
                {t(
                  readOnly
                    ? 'plan.empty.readOnly'
                    : generation
                      ? 'plan.empty.textGenerate'
                      : 'plan.empty.text',
                )}
              </p>
              {readOnly ? null : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    size="s"
                    onClick={() => {
                      editor
                        .chain()
                        .setContent(planTemplate(language))
                        // The caret goes below the first heading, where the writing starts.
                        .command(({ tr }) => {
                          const heading = tr.doc.firstChild;
                          if (heading) {
                            tr.setSelection(
                              TextSelection.near(tr.doc.resolve(heading.nodeSize + 1)),
                            );
                          }
                          return true;
                        })
                        .focus()
                        .run();
                    }}
                  >
                    {t('plan.empty.template')}
                  </Button>
                  {generation ? (
                    <Button size="s" onClick={generation.onGenerate}>
                      <Sparkle />
                      {t('plan.generate')}
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          ) : null}
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
