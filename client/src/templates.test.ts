// Validates the built-in templates: shape, allowed node/mark types, heading
// levels, and that each is serializable by the (pure) markdown exporter — a
// good proxy for "this is valid content the editor can accept".

import { describe, expect, test } from 'bun:test';
import { TEMPLATES, type TemplateNode } from './templates';
import { jsonToMarkdown } from './export/markdown';

// Node/mark types the text-doc schema supports.
const ALLOWED_NODES = new Set([
  'doc',
  'paragraph',
  'heading',
  'text',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'blockquote',
  'horizontalRule',
  'hardBreak',
  'codeBlock',
]);
const ALLOWED_MARKS = new Set([
  'bold',
  'italic',
  'underline',
  'strike',
  'code',
  'link',
  'highlight',
]);

function walk(node: TemplateNode, visit: (n: TemplateNode) => void) {
  visit(node);
  for (const child of node.content ?? []) walk(child, visit);
}

describe('templates', () => {
  test('there is a non-empty set with unique ids', () => {
    expect(TEMPLATES.length).toBeGreaterThan(0);
    const ids = TEMPLATES.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const tpl of TEMPLATES) {
    describe(tpl.name, () => {
      test('has id, name, icon and description', () => {
        expect(tpl.id).toBeTruthy();
        expect(tpl.name).toBeTruthy();
        expect(tpl.icon).toBeTruthy();
        expect(tpl.description).toBeTruthy();
      });

      test('content is a doc node with children', () => {
        expect(tpl.content.type).toBe('doc');
        expect(Array.isArray(tpl.content.content)).toBe(true);
        expect(tpl.content.content.length).toBeGreaterThan(0);
      });

      test('only uses supported node and mark types', () => {
        walk(tpl.content as unknown as TemplateNode, (n) => {
          expect(ALLOWED_NODES.has(n.type)).toBe(true);
          for (const m of n.marks ?? []) {
            expect(ALLOWED_MARKS.has(m.type)).toBe(true);
          }
        });
      });

      test('heading levels are within 1..3', () => {
        walk(tpl.content as unknown as TemplateNode, (n) => {
          if (n.type === 'heading') {
            const lvl = (n.attrs?.level as number) ?? 1;
            expect(lvl).toBeGreaterThanOrEqual(1);
            expect(lvl).toBeLessThanOrEqual(3);
          }
        });
      });

      test('text nodes carry text', () => {
        walk(tpl.content as unknown as TemplateNode, (n) => {
          if (n.type === 'text') expect(typeof n.text).toBe('string');
        });
      });

      test('serializes to markdown without throwing', () => {
        const md = jsonToMarkdown(tpl.content);
        expect(typeof md).toBe('string');
        expect(md.length).toBeGreaterThan(0);
      });
    });
  }
});
