// Built-in document templates, expressed as ProseMirror/Tiptap JSON (the same
// shape as `editor.getJSON()`). Picking a template runs a single
// `editor.commands.setContent(template.content)` transaction on a fresh empty
// doc, which — because the editor is Collaboration-bound — emits an ordinary
// Yjs update that syncs to peers and persists like any other edit.
//
// Node/mark types used here are limited to the text-doc schema: doc,
// paragraph, heading (levels 1-3), bulletList/orderedList/listItem,
// taskList/taskItem, horizontalRule, and text with bold/italic marks.

export type TemplateNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TemplateNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
};

export type TemplateDoc = { type: 'doc'; content: TemplateNode[] };

export type Template = {
  id: string;
  name: string;
  icon: string;
  description: string;
  content: TemplateDoc;
};

// --- Small builders keep the template data readable & consistent. ---------
const t = (text: string, ...marks: Array<{ type: string }>): TemplateNode =>
  marks.length ? { type: 'text', text, marks } : { type: 'text', text };
const bold = { type: 'bold' as const };
const p = (...content: TemplateNode[]): TemplateNode =>
  content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
const h = (level: 1 | 2 | 3, text: string): TemplateNode => ({
  type: 'heading',
  attrs: { level },
  content: [t(text)],
});
const li = (...content: TemplateNode[]): TemplateNode => ({ type: 'listItem', content });
const bullets = (...items: string[]): TemplateNode => ({
  type: 'bulletList',
  content: items.map((s) => li(p(t(s)))),
});
const numbered = (...items: string[]): TemplateNode => ({
  type: 'orderedList',
  content: items.map((s) => li(p(t(s)))),
});
const task = (checked: boolean, text: string): TemplateNode => ({
  type: 'taskItem',
  attrs: { checked },
  content: [p(t(text))],
});
const tasks = (...items: string[]): TemplateNode => ({
  type: 'taskList',
  content: items.map((s) => task(false, s)),
});

export const TEMPLATES: Template[] = [
  {
    id: 'blank',
    name: 'Blank',
    icon: '📄',
    description: 'Start from an empty page.',
    content: { type: 'doc', content: [p()] },
  },
  {
    id: 'meeting-notes',
    name: 'Meeting notes',
    icon: '📝',
    description: 'Agenda, attendees, decisions and action items.',
    content: {
      type: 'doc',
      content: [
        h(1, 'Meeting notes'),
        p(t('Date: '), t('', bold)),
        p(t('Attendees: ')),
        h(2, 'Agenda'),
        bullets('Topic one', 'Topic two', 'Topic three'),
        h(2, 'Discussion'),
        p(),
        h(2, 'Decisions'),
        bullets('Decision…'),
        h(2, 'Action items'),
        tasks('Owner — task…', 'Owner — task…'),
      ],
    },
  },
  {
    id: 'weekly-plan',
    name: 'Weekly plan',
    icon: '🗓️',
    description: 'Goals for the week plus a day-by-day breakdown.',
    content: {
      type: 'doc',
      content: [
        h(1, 'Weekly plan'),
        h(2, 'Goals'),
        tasks('Goal one', 'Goal two', 'Goal three'),
        h(2, 'Monday'),
        p(),
        h(2, 'Tuesday'),
        p(),
        h(2, 'Wednesday'),
        p(),
        h(2, 'Thursday'),
        p(),
        h(2, 'Friday'),
        p(),
        h(2, 'Notes'),
        p(),
      ],
    },
  },
  {
    id: 'todo-list',
    name: 'To-do list',
    icon: '✅',
    description: 'A simple checklist to track tasks.',
    content: {
      type: 'doc',
      content: [
        h(1, 'To-do'),
        h(2, 'Today'),
        tasks('First task', 'Second task', 'Third task'),
        h(2, 'Later'),
        tasks('Something to do later'),
      ],
    },
  },
  {
    id: 'letter',
    name: 'Letter',
    icon: '✉️',
    description: 'A formal letter with salutation and sign-off.',
    content: {
      type: 'doc',
      content: [
        p(t('Your name')),
        p(t('Your address')),
        p(),
        p(t('Date')),
        p(),
        p(t('Dear …,')),
        p(),
        p(
          t(
            'Write your letter here. Replace this paragraph with your message, adding as many paragraphs as you need.',
          ),
        ),
        p(),
        p(t('Sincerely,')),
        p(),
        p(t('Your name')),
      ],
    },
  },
  {
    id: 'project-brief',
    name: 'Project brief',
    icon: '🚀',
    description: 'Overview, goals, scope, timeline and stakeholders.',
    content: {
      type: 'doc',
      content: [
        h(1, 'Project brief'),
        h(2, 'Overview'),
        p(t('A short summary of what this project is and why it matters.')),
        h(2, 'Goals'),
        numbered('Primary goal', 'Secondary goal'),
        h(2, 'Scope'),
        p(t('In scope: ')),
        p(t('Out of scope: ')),
        h(2, 'Timeline'),
        bullets('Milestone 1 — date', 'Milestone 2 — date'),
        h(2, 'Stakeholders'),
        bullets('Name — role'),
      ],
    },
  },
];
