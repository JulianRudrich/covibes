import { useEditorState, type Editor } from '@tiptap/react';
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Redo2,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { IconButton } from '@web/components/ui/icon-button';
import { Tooltip } from '@web/components/ui/tooltip';
import { cn } from '@web/lib/cn';

function ToolButton({
  icon: Icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  /** The format applies to where the caret is; undefined for actions like undo. */
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label}>
      <IconButton
        aria-label={label}
        aria-pressed={active}
        disabled={disabled}
        className={cn(active && 'bg-bg-subtle text-text')}
        // The caret stays in the document: a click on the toolbar must not take the focus.
        onMouseDown={(event) => {
          event.preventDefault();
        }}
        onClick={onClick}
      >
        <Icon size={15} strokeWidth={2} aria-hidden="true" />
      </IconButton>
    </Tooltip>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />;
}

/**
 * The formats of the plan (spec 25a; derived looks): two levels of headings, bold, italic, the two
 * kinds of lists, and undo and redo of one's own changes.
 */
export function PlanToolbar({ editor }: { editor: Editor }) {
  const { t } = useTranslation();
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      heading2: current.isActive('heading', { level: 2 }),
      heading3: current.isActive('heading', { level: 3 }),
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      bulletList: current.isActive('bulletList'),
      orderedList: current.isActive('orderedList'),
      canUndo: current.can().undo(),
      canRedo: current.can().redo(),
    }),
  });
  const run = () => editor.chain().focus();

  return (
    <div
      role="toolbar"
      aria-label={t('plan.toolbar.label')}
      className="flex shrink-0 items-center gap-0.5 border-b border-border-subtle px-3 py-1.5"
    >
      <ToolButton
        icon={Heading2}
        label={t('plan.toolbar.heading')}
        active={state.heading2}
        onClick={() => run().toggleHeading({ level: 2 }).run()}
      />
      <ToolButton
        icon={Heading3}
        label={t('plan.toolbar.subheading')}
        active={state.heading3}
        onClick={() => run().toggleHeading({ level: 3 }).run()}
      />
      <Divider />
      <ToolButton
        icon={Bold}
        label={t('plan.toolbar.bold')}
        active={state.bold}
        onClick={() => run().toggleBold().run()}
      />
      <ToolButton
        icon={Italic}
        label={t('plan.toolbar.italic')}
        active={state.italic}
        onClick={() => run().toggleItalic().run()}
      />
      <Divider />
      <ToolButton
        icon={List}
        label={t('plan.toolbar.bulletList')}
        active={state.bulletList}
        onClick={() => run().toggleBulletList().run()}
      />
      <ToolButton
        icon={ListOrdered}
        label={t('plan.toolbar.orderedList')}
        active={state.orderedList}
        onClick={() => run().toggleOrderedList().run()}
      />
      <Divider />
      <ToolButton
        icon={Undo2}
        label={t('plan.toolbar.undo')}
        disabled={!state.canUndo}
        onClick={() => run().undo().run()}
      />
      <ToolButton
        icon={Redo2}
        label={t('plan.toolbar.redo')}
        disabled={!state.canRedo}
        onClick={() => run().redo().run()}
      />
    </div>
  );
}
