// SheetModel tests: legacy aliasing (no data copy), sheet add/remove/rename,
// geom read/write, and the headline row/col-insert reference rewriting. Uses a
// real Y.Doc and a real CalcEngine (both run under bun).

import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import { SheetModel, LEGACY_SHEET_ID, DEFAULT_ROWS, DEFAULT_COLS } from './model';
import { CalcEngine } from './engine/engine';

function freshModel(): { doc: Y.Doc; model: SheetModel } {
  const doc = new Y.Doc();
  return { doc, model: new SheetModel(doc) };
}

// Build an engine seeded from a model (mirrors what SheetEditor does on mount).
function seed(model: SheetModel): CalcEngine {
  const e = new CalcEngine();
  for (const s of model.list()) {
    e.addSheet(s.name);
    const changes: Array<{ id: string; raw: string }> = [];
    model.cellsMap(s.id).forEach((raw, k) => changes.push({ id: `${s.name}!${k}`, raw }));
    if (changes.length) e.setCells(changes);
  }
  return e;
}

describe('multi-sheet export mapping (folder-zip must not drop tabs)', () => {
  test('list() + cellsMap covers every tab, not just the primary', () => {
    const { doc, model } = freshModel();
    // Tab 1 (s0) via the legacy `cells` map; a second tab via addSheet.
    model.setRaw(LEGACY_SHEET_ID, 0, 0, 'x');
    const id2 = model.addSheet();
    model.setRaw(id2, 0, 0, 'y');

    const sheets = model.list();
    expect(sheets.length).toBe(2);

    // The export path iterates list() → cellsMap(id); it must see BOTH cells.
    const collected = sheets.map((s) => {
      const cells: Record<string, string> = {};
      model.cellsMap(s.id).forEach((v, k) => {
        cells[k] = v;
      });
      return cells;
    });
    expect(collected[0]['0:0']).toBe('x');
    expect(collected[1]['0:0']).toBe('y');

    // The regression: reading only the bare `cells` map would miss tab 2.
    const primaryOnly: Record<string, string> = {};
    doc.getMap<string>('cells').forEach((v, k) => (primaryOnly[k] = v));
    expect(primaryOnly['0:0']).toBe('x');
    expect(Object.keys(primaryOnly)).not.toContain(undefined);
    // tab 2's data is NOT in the primary map — proving the old code dropped it.
    expect(Object.values(primaryOnly)).not.toContain('y');
  });
});

describe('legacy aliasing', () => {
  test('a legacy doc presents as sheet s0 over its existing data (no copy)', () => {
    const { doc, model } = freshModel();
    // Legacy layout: populated `cells` / `cells-style`, no `sheets` order.
    const legacy = doc.getMap<string>('cells');
    legacy.set('0:0', 'hello');
    legacy.set('1:0', '=A1');
    doc.getMap<string>('cells-style').set('0:0', JSON.stringify({ b: 1 }));

    const list = model.list();
    expect(list).toEqual([{ id: LEGACY_SHEET_ID, name: 'Sheet1' }]);
    // s0's backing map IS the legacy map — same object identity, no migration.
    expect(model.cellsMap('s0')).toBe(legacy);
    expect(model.getRaw('s0', 0, 0)).toBe('hello');
    expect(model.getRaw('s0', 1, 0)).toBe('=A1');
    expect(model.getStyle('s0', 0, 0)).toEqual({ b: 1 });
    // No `order` entry was written — legacy data is never moved.
    expect(model.meta().get('order')).toBeUndefined();
  });

  test('a fresh doc also starts as a single s0 sheet', () => {
    const { model } = freshModel();
    expect(model.list()).toEqual([{ id: LEGACY_SHEET_ID, name: 'Sheet1' }]);
    expect(model.order()).toEqual([LEGACY_SHEET_ID]);
  });

  test('s0 aliases the legacy maps; Sheet2 uses suffixed maps', () => {
    const { doc, model } = freshModel();
    expect(model.cellsMap('s0')).toBe(doc.getMap('cells'));
    expect(model.styleMap('s0')).toBe(doc.getMap('cells-style'));
    const id = model.addSheet();
    expect(model.cellsMap(id)).toBe(doc.getMap('cells:' + id));
    expect(model.styleMap(id)).toBe(doc.getMap('style:' + id));
  });
});

describe('add / remove sheet', () => {
  test('addSheet materializes order [s0, new] and default-names sequentially', () => {
    const { model } = freshModel();
    const id2 = model.addSheet();
    expect(model.order()).toEqual([LEGACY_SHEET_ID, id2]);
    expect(model.name(id2)).toBe('Sheet2');
    const id3 = model.addSheet();
    expect(model.list().map((s) => s.name)).toEqual(['Sheet1', 'Sheet2', 'Sheet3']);
    expect(id3).not.toBe(id2);
  });

  test('addSheet honours a custom, unique name and dedupes collisions', () => {
    const { model } = freshModel();
    const a = model.addSheet('Budget');
    expect(model.name(a)).toBe('Budget');
    const b = model.addSheet('Budget'); // collides -> falls back to SheetN
    expect(model.name(b)).not.toBe('Budget');
  });

  test('removeSheet drops it from order and clears its maps', () => {
    const { model } = freshModel();
    const id2 = model.addSheet();
    model.setRaw(id2, 0, 0, '99');
    expect(model.getRaw(id2, 0, 0)).toBe('99');
    model.removeSheet(id2);
    expect(model.order()).toEqual([LEGACY_SHEET_ID]);
    expect(model.cellsMap(id2).size).toBe(0);
  });

  test('removeSheet refuses to remove the last remaining sheet', () => {
    const { model } = freshModel();
    model.removeSheet(LEGACY_SHEET_ID);
    expect(model.order()).toEqual([LEGACY_SHEET_ID]);
  });
});

describe('rename sheet', () => {
  test('renameSheet drives the engine, rewrites qualified refs, and persists', () => {
    const { model } = freshModel();
    const dataId = model.addSheet('Data');
    model.setRaw(dataId, 0, 0, '5');
    model.setRaw(LEGACY_SHEET_ID, 0, 0, '=Data!A1*2');

    const engine = seed(model);
    expect(engine.getValue('Sheet1!0:0')).toBe(10);

    const repaint = model.renameSheet(dataId, 'Numbers', engine);
    expect(repaint).not.toBeNull();
    // Engine now resolves under the new name.
    expect(engine.getValue('Sheet1!0:0')).toBe(10);
    // Persisted formula text was rewritten in Yjs.
    expect(model.getRaw(LEGACY_SHEET_ID, 0, 0)).toBe('=Numbers!A1*2');
    expect(model.name(dataId)).toBe('Numbers');
  });

  test('renameSheet rejects a colliding name', () => {
    const { model } = freshModel();
    const id2 = model.addSheet('Data');
    const engine = seed(model);
    expect(model.renameSheet(id2, 'Sheet1', engine)).toBeNull();
    expect(model.name(id2)).toBe('Data');
  });
});

describe('geom read/write', () => {
  test('defaults to 1000 x 26 with no freeze', () => {
    const { model } = freshModel();
    const g = model.getGeom(LEGACY_SHEET_ID);
    expect(g.rows).toBe(DEFAULT_ROWS);
    expect(g.cols).toBe(DEFAULT_COLS);
    expect(g.frozenRows).toBe(0);
    expect(g.frozenCols).toBe(0);
  });

  test('persists dims and freeze', () => {
    const { model } = freshModel();
    model.setGeom(LEGACY_SHEET_ID, { rows: 2000, frozenRows: 1, frozenCols: 2 });
    const g = model.getGeom(LEGACY_SHEET_ID);
    expect(g.rows).toBe(2000);
    expect(g.cols).toBe(DEFAULT_COLS);
    expect(g.frozenRows).toBe(1);
    expect(g.frozenCols).toBe(2);
  });
});

describe('structural edits rewrite references (headline fix)', () => {
  test('insertRows shifts cell keys AND rewrites =SUM(A2:A10)', () => {
    const { model } = freshModel();
    model.setRaw(LEGACY_SHEET_ID, 1, 0, '10'); // A2
    model.setRaw(LEGACY_SHEET_ID, 0, 2, '=SUM(A2:A10)'); // C1 (outside the range)

    model.insertRows(LEGACY_SHEET_ID, 0, 1); // insert a row at the very top

    // Data cell moved down one row.
    expect(model.getRaw(LEGACY_SHEET_ID, 2, 0)).toBe('10');
    expect(model.getRaw(LEGACY_SHEET_ID, 1, 0)).toBe('');
    // Formula moved AND its range followed the insert.
    expect(model.getRaw(LEGACY_SHEET_ID, 1, 2)).toBe('=SUM(A3:A11)');

    // And the engine agrees after re-seeding.
    const engine = seed(model);
    expect(engine.getValue('Sheet1!1:2')).toBe(10);
  });

  test('insertCols rewrites column references', () => {
    const { model } = freshModel();
    model.setRaw(LEGACY_SHEET_ID, 0, 2, '=A1+B1'); // C1 references A1,B1
    model.insertCols(LEGACY_SHEET_ID, 0, 1); // insert a column at the left
    expect(model.getRaw(LEGACY_SHEET_ID, 0, 3)).toBe('=B1+C1');
  });

  test('deleteRows removes the band and shifts refs, deleted refs become #REF!', () => {
    const { model } = freshModel();
    model.setRaw(LEGACY_SHEET_ID, 0, 0, '1'); // A1
    model.setRaw(LEGACY_SHEET_ID, 2, 0, '=A1'); // A3 -> A1
    model.setRaw(LEGACY_SHEET_ID, 3, 0, '=A3'); // A4 references the row we delete
    model.deleteRows(LEGACY_SHEET_ID, 2, 1); // delete row index 2 (A3)

    // A4 moved up to A3; its ref to the deleted row is now #REF!.
    expect(model.getRaw(LEGACY_SHEET_ID, 2, 0)).toBe('=#REF!');
    // A1 untouched.
    expect(model.getRaw(LEGACY_SHEET_ID, 0, 0)).toBe('1');
  });

  test('cross-sheet references follow a structural edit on the referenced sheet', () => {
    const { model } = freshModel();
    const dataId = model.addSheet('Data');
    model.setRaw(dataId, 1, 0, '7'); // Data!A2
    model.setRaw(LEGACY_SHEET_ID, 0, 0, '=Data!A2'); // Sheet1!A1 -> Data!A2

    model.insertRows(dataId, 0, 1); // insert a row atop Data

    expect(model.getRaw(dataId, 2, 0)).toBe('7'); // moved down
    expect(model.getRaw(LEGACY_SHEET_ID, 0, 0)).toBe('=Data!A3'); // ref followed
  });
});

// Bug 3: structural() must reindex the geom map so per-index sizing and the
// sheet dims follow an insert / delete, not just the cell/style keys.
describe('structural edits reindex geometry (Bug 3)', () => {
  test('insertCols shifts colWidths past the insert and grows cols', () => {
    const { model } = freshModel();
    model.setGeom(LEGACY_SHEET_ID, { colWidths: { 5: 120 } });
    model.insertCols(LEGACY_SHEET_ID, 0, 1); // insert a column at the left
    const g = model.getGeom(LEGACY_SHEET_ID);
    expect(g.colWidths[6]).toBe(120); // width followed the inserted column
    expect(g.colWidths[5]).toBeUndefined();
    expect(g.cols).toBe(DEFAULT_COLS + 1); // dims grew so nothing spills off-grid
  });

  test('insertRows shifts rowHeights and grows rows', () => {
    const { model } = freshModel();
    model.setGeom(LEGACY_SHEET_ID, { rowHeights: { 3: 40 } });
    model.insertRows(LEGACY_SHEET_ID, 0, 2);
    const g = model.getGeom(LEGACY_SHEET_ID);
    expect(g.rowHeights[5]).toBe(40); // 3 -> 5 (delta 2)
    expect(g.rowHeights[3]).toBeUndefined();
    expect(g.rows).toBe(DEFAULT_ROWS + 2);
  });

  test('deleteRows removes the band entry and shifts later ones down', () => {
    const { model } = freshModel();
    model.setGeom(LEGACY_SHEET_ID, { rowHeights: { 2: 40, 5: 60 } });
    model.deleteRows(LEGACY_SHEET_ID, 2, 1); // delete row index 2
    const g = model.getGeom(LEGACY_SHEET_ID);
    expect(g.rowHeights[2]).toBeUndefined(); // the deleted row's height is gone
    expect(g.rowHeights[4]).toBe(60); // row 5 -> 4
  });
});

// Bug 2: the sheet list is a CRDT (Y.Array order + Y.Map names) so concurrent
// structural edits from two peers merge element-wise instead of clobbering.
describe('CRDT sheet list (Bug 2)', () => {
  test('concurrent addSheet on two peers both survive after a merge', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const mA = new SheetModel(docA);
    const mB = new SheetModel(docB);

    // Each peer adds a distinct sheet with data, offline (no sync yet).
    const idA = mA.addSheet('Alpha');
    mA.setRaw(idA, 0, 0, 'a-data');
    const idB = mB.addSheet('Beta');
    mB.setRaw(idB, 0, 0, 'b-data');
    expect(idA).not.toBe(idB);

    // Exchange full state both ways (a two-way merge).
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    for (const m of [mA, mB]) {
      const order = m.order();
      // Both new sheets AND the legacy s0 survive, with no duplicates.
      expect(order).toContain(LEGACY_SHEET_ID);
      expect(order).toContain(idA);
      expect(order).toContain(idB);
      expect(new Set(order).size).toBe(order.length);
      // Both cells maps are reachable with their data (nothing orphaned).
      expect(m.getRaw(idA, 0, 0)).toBe('a-data');
      expect(m.getRaw(idB, 0, 0)).toBe('b-data');
    }
  });

  test('migrates a legacy plain-JSON sheet list into the CRDT structures', () => {
    const { doc, model } = freshModel();
    // A just-shipped doc: plain-JSON order + names on the 'sheets' meta map.
    doc.getMap('sheets').set('order', [LEGACY_SHEET_ID, 's-old']);
    doc.getMap('sheets').set('names', { [LEGACY_SHEET_ID]: 'Sheet1', 's-old': 'Legacy' });

    // Reads work off the plain shape, before any migration write.
    expect(model.order()).toEqual([LEGACY_SHEET_ID, 's-old']);
    expect(model.name('s-old')).toBe('Legacy');
    expect(doc.getArray('sheet-order').length).toBe(0); // not yet materialized

    // A list mutation seeds the CRDT structures without losing existing sheets.
    const idNew = model.addSheet('Fresh');
    expect(model.order()).toEqual([LEGACY_SHEET_ID, 's-old', idNew]);
    expect(doc.getArray<string>('sheet-order').toArray()).toEqual([LEGACY_SHEET_ID, 's-old', idNew]);
    expect(doc.getMap<string>('sheet-names').get('s-old')).toBe('Legacy');
    expect(model.name(idNew)).toBe('Fresh');
  });

  test('a bare single-sheet doc still presents s0 without any migration write', () => {
    const { doc, model } = freshModel();
    expect(model.order()).toEqual([LEGACY_SHEET_ID]);
    // Pure reads never materialize the CRDT list (read-only viewers stay clean).
    expect(doc.getArray('sheet-order').length).toBe(0);
    expect(doc.getMap('sheets').get('rev')).toBeUndefined();
  });
});
