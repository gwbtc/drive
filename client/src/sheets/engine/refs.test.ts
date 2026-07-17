// Reference-transform tests: insert/delete (shiftRefs), fill/drag
// (offsetRefs), and sheet rename (renameSheetRefs). Every transform is checked
// through the serializer so we know it round-trips to valid formula text.

import { describe, expect, test } from 'bun:test';
import { parse, serialize } from './ast';
import { shiftRefs, offsetRefs, renameSheetRefs, type ShiftOpts } from './refs';

const shift = (f: string, opts: ShiftOpts) => serialize(shiftRefs(parse(f), opts));
const offset = (f: string, dRow: number, dCol: number) => serialize(offsetRefs(parse(f), { dRow, dCol }));

describe('shiftRefs — insert rows', () => {
  const ins = (at: number, delta = 1): ShiftOpts => ({ sheet: 'S', axis: 'row', at, delta });

  test('ref below insertion point shifts down', () => {
    // Insert a row at index 2 (row 3); A5 (row 4) -> A6.
    expect(shift('=A5', ins(2))).toBe('A6');
  });
  test('ref above insertion point is unchanged', () => {
    expect(shift('=A1', ins(2))).toBe('A1');
  });
  // A `$` anchor pins a ref during COPY/FILL (offsetRefs), NOT across a
  // structural insert/delete: the data physically moves, so the coordinate must
  // renumber while KEEPING its `$` flag (A$5 -> A$6, not A$5 and not A6).
  test('row-absolute ref renumbers but keeps its $', () => {
    expect(shift('=A$5', ins(2))).toBe('A$6');
  });
  test('fully-absolute range grows when a row is inserted inside it', () => {
    expect(shift('=SUM($A$1:$A$5)', ins(2))).toBe('SUM($A$1:$A$6)');
  });
  test('column-only insert leaves row refs alone', () => {
    expect(shift('=A5', { sheet: 'S', axis: 'col', at: 0, delta: 1 })).toBe('B5');
  });
  test('column-absolute ref renumbers on column insert but keeps its $', () => {
    expect(shift('=$B5', { sheet: 'S', axis: 'col', at: 0, delta: 1 })).toBe('$C5');
  });
  test('inserting inside a range grows it', () => {
    // Range A1:A10, insert a row at index 5 -> A1:A11.
    expect(shift('=SUM(A1:A10)', ins(5))).toBe('SUM(A1:A11)');
  });
});

describe('shiftRefs — delete rows', () => {
  const del = (at: number, count = 1): ShiftOpts => ({ sheet: 'S', axis: 'row', at, delta: -count });

  test('ref below the deleted row shifts up', () => {
    expect(shift('=A5', del(1))).toBe('A4');
  });
  test('ref above the deleted row is unchanged', () => {
    expect(shift('=A1', del(3))).toBe('A1');
  });
  test('deleting the referenced cell yields #REF!', () => {
    expect(shift('=A3', del(2))).toBe('#REF!');
  });
  // An absolute ref is renumbered/wiped exactly like a relative one on delete.
  test('deleting the row an absolute ref sits on yields #REF!', () => {
    expect(shift('=$A$3', del(2))).toBe('#REF!');
  });
  test('absolute ref below the deleted row shifts up, keeping its $', () => {
    expect(shift('=A$5', del(1))).toBe('A$4');
  });
  test('range fully inside the deleted band becomes #REF! (in place)', () => {
    // Delete rows 1..2 (indices), range A2:A3 (rows 1..2) is wiped; the range
    // argument turns into #REF! while the surrounding call is preserved.
    expect(shift('=SUM(A2:A3)', del(1, 2))).toBe('SUM(#REF!)');
  });
  test('range partially overlapping the deleted band clamps', () => {
    // A1:A5 (rows 0..4), delete rows 1..2 -> A1:A3.
    expect(shift('=SUM(A1:A5)', del(1, 2))).toBe('SUM(A1:A3)');
  });
});

describe('shiftRefs — sheet scoping', () => {
  test('only refs on the edited sheet shift (qualified other-sheet ref untouched)', () => {
    const opts: ShiftOpts = { sheet: 'Sheet1', axis: 'row', at: 0, delta: 1, homeSheet: 'Sheet1' };
    expect(shift('=A1+Sheet2!A1', opts)).toBe('A2+Sheet2!A1');
  });
  test('editing the referenced foreign sheet shifts the qualified ref', () => {
    const opts: ShiftOpts = { sheet: 'Sheet2', axis: 'row', at: 0, delta: 1, homeSheet: 'Sheet1' };
    expect(shift('=A1+Sheet2!A1', opts)).toBe('A1+Sheet2!A2');
  });
});

describe('offsetRefs — fill / drag', () => {
  test('relative refs shift by the offset', () => {
    expect(offset('=A1+B1', 1, 0)).toBe('A2+B2');
  });
  test('absolute refs stay put; mixed refs shift only the relative axis', () => {
    expect(offset('=$A$1', 2, 3)).toBe('$A$1');
    expect(offset('=$A1', 2, 3)).toBe('$A3');   // column pinned, row shifts
    expect(offset('=A$1', 2, 3)).toBe('D$1');   // row pinned, column shifts
  });
  test('ranges offset both corners', () => {
    expect(offset('=SUM(A1:B2)', 0, 1)).toBe('SUM(B1:C2)');
  });
  test('offset below zero is #REF!', () => {
    expect(offset('=A1', -1, 0)).toBe('#REF!');
  });
  test('function-nested refs are transformed', () => {
    expect(offset('=IF(A1>0,B1,C1)', 1, 0)).toBe('IF(A2>0,B2,C2)');
  });
});

describe('renameSheetRefs', () => {
  test('qualified refs get the new name', () => {
    expect(serialize(renameSheetRefs(parse('=Old!A1+1'), 'Old', 'New'))).toBe('New!A1+1');
  });
  test('unqualified refs untouched', () => {
    expect(serialize(renameSheetRefs(parse('=A1+Other!B2'), 'Old', 'New'))).toBe('A1+Other!B2');
  });
  test('renames inside ranges and calls', () => {
    expect(serialize(renameSheetRefs(parse('=SUM(Old!A1:A9)'), 'Old', 'New'))).toBe('SUM(New!A1:A9)');
  });
});

describe('round-trip guarantee', () => {
  test('shifted output re-parses', () => {
    // $B$2 renumbers to $B$5 on a structural insert (absolute flag preserved,
    // coordinate still moves — see Bug 1).
    const out = shift('=SUM(A1:A10)+$B$2', { sheet: 'S', axis: 'row', at: 0, delta: 3 });
    expect(() => parse('=' + out)).not.toThrow();
    expect(out).toBe('SUM(A4:A13)+$B$5');
  });
});
