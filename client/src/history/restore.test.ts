import { describe, expect, test } from 'bun:test';
import * as Y from 'yjs';
import {
  decodeVersion,
  extractPlainText,
  extractSheetText,
  restoreSheetInto,
  syncMap,
} from './restore';
import { SheetModel, LEGACY_SHEET_ID } from '../sheets/model';

describe('decodeVersion', () => {
  test('round-trips an encoded Y.Doc state', () => {
    const src = new Y.Doc();
    src.getMap<string>('cells').set('0:0', 'hi');
    const blob = Array.from(Y.encodeStateAsUpdate(src));
    const doc = decodeVersion(blob);
    expect(doc.getMap<string>('cells').get('0:0')).toBe('hi');
  });
});

describe('syncMap', () => {
  test('makes live equal scratch: adds, updates, and deletes keys', () => {
    const doc = new Y.Doc();
    const live = doc.getMap<string>('live');
    const scratch = new Y.Doc().getMap<string>('scratch');
    live.set('keep', 'old');
    live.set('drop', 'gone');
    scratch.set('keep', 'new');
    scratch.set('add', 'fresh');

    doc.transact(() => syncMap(live, scratch));

    expect(live.get('keep')).toBe('new');
    expect(live.get('add')).toBe('fresh');
    expect(live.has('drop')).toBe(false);
    expect(Array.from(live.keys()).sort()).toEqual(['add', 'keep']);
  });
});

describe('restoreSheetInto', () => {
  test('reconciles cells and cells-style in one authored update', () => {
    const live = new Y.Doc();
    const liveCells = live.getMap<string>('cells');
    const liveStyle = live.getMap<string>('cells-style');
    liveCells.set('0:0', 'stale');
    liveCells.set('9:9', 'orphan');
    liveStyle.set('0:0', 'b=1');

    const scratch = new Y.Doc();
    scratch.getMap<string>('cells').set('0:0', 'restored');
    scratch.getMap<string>('cells').set('1:1', 'added');
    scratch.getMap<string>('cells-style').set('1:1', 'i=1');

    let updates = 0;
    live.on('update', () => {
      updates += 1;
    });
    restoreSheetInto(live, scratch);

    expect(updates).toBe(1); // one transaction => one forward update
    expect(liveCells.get('0:0')).toBe('restored');
    expect(liveCells.get('1:1')).toBe('added');
    expect(liveCells.has('9:9')).toBe(false);
    expect(liveStyle.has('0:0')).toBe(false);
    expect(liveStyle.get('1:1')).toBe('i=1');
  });
});

// Bug 1: restore must reproduce the saved version across ALL sheets, not just
// the two legacy s0 maps. A version blob holds the full doc (every sheet + the
// meta list + geometry), so restore recreates deleted sheets, drops sheets
// added after the version, and reverts cells / styles / geometry.
describe('restoreSheetInto multi-sheet (Bug 1)', () => {
  test('recreates a deleted sheet with its data and reverts the surviving one', () => {
    const live = new Y.Doc();
    const lm = new SheetModel(live);
    lm.setRaw(LEGACY_SHEET_ID, 0, 0, 'one-orig');
    const s2 = lm.addSheet('Data');
    lm.setRaw(s2, 0, 0, 'two-data');
    lm.setStyle(s2, 0, 0, { b: 1 });
    lm.setGeom(s2, { frozenRows: 1 });

    // Snapshot this two-sheet state as a version.
    const blob = Array.from(Y.encodeStateAsUpdate(live));

    // Diverge: delete Sheet2 (its cells:<id> map is cleared) and edit Sheet1.
    lm.removeSheet(s2);
    lm.setRaw(LEGACY_SHEET_ID, 0, 0, 'one-edited');
    expect(lm.order()).toEqual([LEGACY_SHEET_ID]);
    expect(lm.getRaw(s2, 0, 0)).toBe('');

    restoreSheetInto(live, decodeVersion(blob));

    // Sheet2 is back, with cells + style + geom; Sheet1 reverted.
    expect(lm.order()).toContain(s2);
    expect(lm.name(s2)).toBe('Data');
    expect(lm.getRaw(s2, 0, 0)).toBe('two-data');
    expect(lm.getStyle(s2, 0, 0)).toEqual({ b: 1 });
    expect(lm.getGeom(s2).frozenRows).toBe(1);
    expect(lm.getRaw(LEGACY_SHEET_ID, 0, 0)).toBe('one-orig');
  });

  test('drops a sheet that was added after the version', () => {
    const live = new Y.Doc();
    const lm = new SheetModel(live);
    lm.setRaw(LEGACY_SHEET_ID, 0, 0, 'base');

    // Version has a single sheet.
    const blob = Array.from(Y.encodeStateAsUpdate(live));

    const extra = lm.addSheet('Extra');
    lm.setRaw(extra, 0, 0, 'extra-data');
    expect(lm.order()).toEqual([LEGACY_SHEET_ID, extra]);

    restoreSheetInto(live, decodeVersion(blob));

    expect(lm.order()).toEqual([LEGACY_SHEET_ID]);
    expect(lm.cellsMap(extra).size).toBe(0); // the extra sheet's data is cleared
    expect(lm.getRaw(LEGACY_SHEET_ID, 0, 0)).toBe('base');
  });

  test('reverts geometry (dims + freeze) to the saved version', () => {
    const live = new Y.Doc();
    const lm = new SheetModel(live);
    lm.setGeom(LEGACY_SHEET_ID, { rows: 500, frozenRows: 2 });

    const blob = Array.from(Y.encodeStateAsUpdate(live));

    // Change geometry after the version was saved.
    lm.setGeom(LEGACY_SHEET_ID, { rows: 3000, frozenRows: 0, frozenCols: 4 });

    restoreSheetInto(live, decodeVersion(blob));

    const g = lm.getGeom(LEGACY_SHEET_ID);
    expect(g.rows).toBe(500);
    expect(g.frozenRows).toBe(2);
    expect(g.frozenCols).toBe(0); // present live, absent in the version -> default
  });

  test('still reconciles in a single authored update across many sheets', () => {
    const live = new Y.Doc();
    const lm = new SheetModel(live);
    const s2 = lm.addSheet('Two');
    lm.setRaw(LEGACY_SHEET_ID, 0, 0, 'a');
    lm.setRaw(s2, 0, 0, 'b');
    const blob = Array.from(Y.encodeStateAsUpdate(live));

    lm.setRaw(LEGACY_SHEET_ID, 0, 0, 'changed');
    lm.removeSheet(s2);

    let updates = 0;
    live.on('update', () => { updates += 1; });
    restoreSheetInto(live, decodeVersion(blob));
    expect(updates).toBe(1); // one transaction => one forward update
  });
});

describe('extractPlainText', () => {
  test('reads text out of a Tiptap-style XmlFragment', () => {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment('default');
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText('Hello world')]);
    frag.insert(0, [p]);
    expect(extractPlainText(doc)).toBe('Hello world');
  });

  test('empty doc yields empty string', () => {
    expect(extractPlainText(new Y.Doc())).toBe('');
  });
});

describe('extractSheetText', () => {
  test('lists non-empty cells sorted by key', () => {
    const doc = new Y.Doc();
    const cells = doc.getMap<string>('cells');
    cells.set('1:0', 'b');
    cells.set('0:0', 'a');
    cells.set('2:0', '');
    expect(extractSheetText(doc)).toBe('0:0\ta\n1:0\tb');
  });

  test('empty sheet reports emptiness', () => {
    expect(extractSheetText(new Y.Doc())).toBe('(empty spreadsheet)');
  });
});
