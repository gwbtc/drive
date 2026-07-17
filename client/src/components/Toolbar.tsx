import type { Editor } from '@tiptap/core';
import { useEffect, useState } from 'preact/hooks';
import { promptDialog } from '../ui/dialogs';
import { Dropdown } from './toolbar/Dropdown';
import { ColorSwatch } from './toolbar/ColorSwatch';

type Props = { editor: Editor | null; variant?: 'text' | 'note' };

const FONT_FAMILIES: Array<{ label: string; value: string | null }> = [
  { label: 'Default', value: null },
  { label: 'Serif', value: '"Charter", "Iowan Old Style", Georgia, serif' },
  { label: 'Sans', value: '"Inter", system-ui, sans-serif' },
  { label: 'Mono', value: '"Berkeley Mono", "JetBrains Mono", Menlo, monospace' },
];

const FONT_SIZES: Array<{ label: string; value: string | null }> = [
  { label: 'Default', value: null },
  { label: '12', value: '12px' },
  { label: '14', value: '14px' },
  { label: '16', value: '16px' },
  { label: '18', value: '18px' },
  { label: '22', value: '22px' },
  { label: '28', value: '28px' },
  { label: '36', value: '36px' },
];

export function Toolbar({ editor, variant = 'text' }: Props) {
  const [, force] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const tick = () => force((n) => n + 1);
    editor.on('selectionUpdate', tick);
    editor.on('transaction', tick);
    return () => {
      editor.off('selectionUpdate', tick);
      editor.off('transaction', tick);
    };
  }, [editor]);

  if (!editor) return null;

  // Build chain lazily inside each click handler — chain().focus() at render
  // schedules a rAF view.focus() that traps focus on sibling inputs.
  const chain = () => editor.chain().focus();

  const Btn = ({
    label,
    cmd,
    active,
    title,
    disabled = false,
  }: {
    label: string | preact.JSX.Element;
    cmd: () => void;
    active?: boolean;
    title?: string;
    disabled?: boolean;
  }) => (
    <button
      class={`tb-btn ${active ? 'active' : ''}`}
      onMouseDown={(e) => {
        e.preventDefault();
        if (!disabled) cmd();
      }}
      title={title}
      aria-label={title}
      // Only toggle buttons pass `active`; action buttons (undo, insert table,
      // …) leave it undefined so they don't misreport a pressed state.
      aria-pressed={active}
      disabled={disabled}
    >
      {label}
    </button>
  );

  const Sep = () => <span class="tb-sep" aria-hidden="true" />;

  const isNote = variant === 'note';

  const promptLink = async () => {
    const prev = editor.getAttributes('link').href;
    const url = await promptDialog({
      title: prev ? 'Edit link' : 'Add link',
      placeholder: 'https://example.com',
      defaultValue: prev || '',
      confirmLabel: prev ? 'Update' : 'Add',
    });
    if (url === null) return;
    if (url.trim() === '') {
      chain().extendMarkRange('link').unsetLink().run();
      return;
    }
    chain().extendMarkRange('link').setLink({ href: url.trim() }).run();
  };

  const insertTable = () => {
    chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  };

  const insertImage = async () => {
    const url = await promptDialog({
      title: 'Insert image',
      placeholder: 'https://example.com/image.png',
      confirmLabel: 'Insert',
    });
    if (!url?.trim()) return;
    chain().setImage({ src: url.trim() }).run();
  };

  const setColor = (color: string | null) => {
    if (color === null) chain().unsetColor().run();
    else chain().setColor(color).run();
  };

  const setFontFamily = (family: string | null) => {
    if (family === null) chain().unsetFontFamily().run();
    else chain().setFontFamily(family).run();
  };

  const setFontSize = (size: string | null) => {
    if (size === null) chain().unsetFontSize().run();
    else chain().setFontSize(size).run();
  };

  const clearFormatting = () => {
    chain().clearNodes().unsetAllMarks().run();
  };

  const currentFontFamily =
    (editor.getAttributes('textStyle').fontFamily as string | undefined) || null;
  const currentFontSize =
    (editor.getAttributes('textStyle').fontSize as string | undefined) || null;
  const currentColor =
    (editor.getAttributes('textStyle').color as string | undefined) || null;

  return (
    <div class="toolbar toolbar-two-row" role="toolbar" aria-label="Formatting">
      <div class="toolbar-row">
        <Btn label={<b>B</b>} cmd={() => chain().toggleBold().run()} active={editor.isActive('bold')} title="Bold (⌘B)" />
        <Btn label={<i>I</i>} cmd={() => chain().toggleItalic().run()} active={editor.isActive('italic')} title="Italic (⌘I)" />
        <Btn label={<u>U</u>} cmd={() => chain().toggleUnderline().run()} active={editor.isActive('underline')} title="Underline (⌘U)" />
        <Btn label={<s>S</s>} cmd={() => chain().toggleStrike().run()} active={editor.isActive('strike')} title="Strikethrough" />
        <Sep />
        <Btn label={<>X<sub>2</sub></>} cmd={() => chain().toggleSubscript().run()} active={editor.isActive('subscript')} title="Subscript" />
        <Btn label={<>X<sup>2</sup></>} cmd={() => chain().toggleSuperscript().run()} active={editor.isActive('superscript')} title="Superscript" />
        {!isNote && (
          <>
            <Sep />
            <Dropdown
              label={<span class="tb-font-label">{FONT_FAMILIES.find((f) => f.value === currentFontFamily)?.label ?? 'Default'}</span>}
              title="Font family"
            >
              {(close) => (
                <ul class="tb-drop-list">
                  {FONT_FAMILIES.map((f) => (
                    <li key={f.label}>
                      <button
                        class={`tb-drop-item ${currentFontFamily === f.value ? 'selected' : ''}`}
                        style={f.value ? { fontFamily: f.value } : undefined}
                        onClick={() => {
                          setFontFamily(f.value);
                          close();
                        }}
                      >
                        {f.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Dropdown>
            <Dropdown
              label={<span class="tb-font-label">{FONT_SIZES.find((f) => f.value === currentFontSize)?.label ?? 'Size'}</span>}
              title="Font size"
            >
              {(close) => (
                <ul class="tb-drop-list">
                  {FONT_SIZES.map((f) => (
                    <li key={f.label}>
                      <button
                        class={`tb-drop-item ${currentFontSize === f.value ? 'selected' : ''}`}
                        onClick={() => {
                          setFontSize(f.value);
                          close();
                        }}
                      >
                        {f.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Dropdown>
            <ColorSwatch
              label={<span class="tb-color-label" style={currentColor ? { color: currentColor } : undefined}>A</span>}
              title="Text color"
              value={currentColor}
              onPick={setColor}
            />
          </>
        )}
        <Btn
          label="🖍"
          cmd={() => chain().toggleHighlight().run()}
          active={editor.isActive('highlight')}
          title="Highlight"
        />
        <Sep />
        <Btn label="Tx" cmd={clearFormatting} title="Clear formatting" />
      </div>
      <div class="toolbar-row">
        {!isNote && (
          <>
            <Btn label="H1" cmd={() => chain().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="Heading 1" />
            <Btn label="H2" cmd={() => chain().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="Heading 2" />
            <Btn label="H3" cmd={() => chain().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="Heading 3" />
            <Sep />
          </>
        )}
        <Btn label="•" cmd={() => chain().toggleBulletList().run()} active={editor.isActive('bulletList')} title="Bullet list" />
        <Btn label="1." cmd={() => chain().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="Ordered list" />
        {!isNote && (
          <Btn label="☐" cmd={() => chain().toggleTaskList().run()} active={editor.isActive('taskList')} title="Task list" />
        )}
        <Btn
          label="↤"
          cmd={() => {
            const list = editor.isActive('taskList') ? 'taskItem' : 'listItem';
            chain().liftListItem(list).run();
          }}
          title="Outdent"
        />
        <Btn
          label="↦"
          cmd={() => {
            const list = editor.isActive('taskList') ? 'taskItem' : 'listItem';
            chain().sinkListItem(list).run();
          }}
          title="Indent"
        />
        {!isNote && (
          <>
            <Sep />
            <Btn label={<span class="tb-icon-align">⬱</span>} cmd={() => chain().setTextAlign('left').run()} active={editor.isActive({ textAlign: 'left' })} title="Align left" />
            <Btn label={<span class="tb-icon-align">≡</span>} cmd={() => chain().setTextAlign('center').run()} active={editor.isActive({ textAlign: 'center' })} title="Align center" />
            <Btn label={<span class="tb-icon-align">⬲</span>} cmd={() => chain().setTextAlign('right').run()} active={editor.isActive({ textAlign: 'right' })} title="Align right" />
            <Btn label={<span class="tb-icon-align">≣</span>} cmd={() => chain().setTextAlign('justify').run()} active={editor.isActive({ textAlign: 'justify' })} title="Justify" />
          </>
        )}
        <Sep />
        <Btn label="🔗" cmd={promptLink} active={editor.isActive('link')} title="Insert/edit link" />
        {!isNote && (
          <>
            <Btn label="❝" cmd={() => chain().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="Blockquote" />
            <Btn label="</>" cmd={() => chain().toggleCode().run()} active={editor.isActive('code')} title="Inline code" />
            <Btn label="{}" cmd={() => chain().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="Code block" />
            <Sep />
            <Btn label="⊞" cmd={insertTable} title="Insert table" />
            <Btn label="🖼" cmd={insertImage} title="Insert image (or drag/paste)" />
          </>
        )}
        <Sep />
        <Btn label="↶" cmd={() => chain().undo().run()} title="Undo (⌘Z)" />
        <Btn label="↷" cmd={() => chain().redo().run()} title="Redo (⌘⇧Z)" />
        {editor.isActive('table') && !isNote && (
          <span class="tb-table-actions">
            <Sep />
            <Btn label="+row" cmd={() => chain().addRowAfter().run()} title="Add row below" />
            <Btn label="−row" cmd={() => chain().deleteRow().run()} title="Delete row" />
            <Btn label="+col" cmd={() => chain().addColumnAfter().run()} title="Add column right" />
            <Btn label="−col" cmd={() => chain().deleteColumn().run()} title="Delete column" />
            <Btn label="−tbl" cmd={() => chain().deleteTable().run()} title="Delete table" />
          </span>
        )}
      </div>
    </div>
  );
}
