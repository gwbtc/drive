// Tests for the Milestone 3 Phase C function batch (IFERROR, IFNA, COUNTA,
// COUNTBLANK, TEXT, SUMPRODUCT, ROUNDUP/ROUNDDOWN, POWER, MOD, XLOOKUP) plus
// the VLOOKUP approximate-match 4th argument and MATCH match_type 1/-1.
//
// Golden values are the Google Sheets results. Where Sheets behaviour is
// ambiguous or this engine deliberately differs, the choice is noted inline.
// Style mirrors engine.test.ts: everything is driven through the real
// CalcEngine (parse + evaluate), not the registry directly.

import { describe, expect, test } from 'bun:test';
import { CalcEngine } from './engine';
import { type Scalar, isErr } from './types';

const TARGET = 'S!30:30';

function build(raw: string, cells: Record<string, string> = {}): CalcEngine {
  const e = new CalcEngine();
  e.addSheet('S');
  const changes = Object.entries(cells).map(([k, v]) => ({ id: `S!${k}`, raw: v }));
  changes.push({ id: TARGET, raw });
  e.setCells(changes);
  return e;
}
function val(raw: string, cells: Record<string, string> = {}): Scalar {
  return build(raw, cells).getValue(TARGET);
}
function ok(raw: string, cells: Record<string, string> = {}): Exclude<Scalar, { err: string }> {
  const v = val(raw, cells);
  if (isErr(v)) throw new Error(`expected ok for ${raw}, got ${v.err}`);
  return v;
}
function errc(raw: string, cells: Record<string, string> = {}): string {
  const v = val(raw, cells);
  if (!isErr(v)) throw new Error(`expected error for ${raw}, got ${String(v)}`);
  return v.err;
}

// -----------------------------------------------------------------------------

describe('IFERROR', () => {
  test('catches #DIV/0', () => expect(ok('=IFERROR(1/0,"oops")')).toBe('oops'));
  test('catches #ERR', () => expect(ok('=IFERROR(SQRT(-1),"bad")')).toBe('bad'));
  test('catches #N/A from a lookup', () =>
    expect(ok('=IFERROR(VLOOKUP("z",A1:B2,2,FALSE),"nf")', { '0:0': 'a', '0:1': '1' })).toBe('nf'));
  test('passes through a non-error value', () => expect(ok('=IFERROR(42,"x")')).toBe(42));
  test('passes through text', () => expect(ok('=IFERROR("hi","x")')).toBe('hi'));
  test('default fallback is blank', () => expect(val('=IFERROR(1/0)')).toBe(''));
  test('fallback is lazy — not evaluated when value is ok', () =>
    expect(ok('=IFERROR(10/2,1/0)')).toBe(5));
  test('one-arg ok value returns it', () => expect(ok('=IFERROR(7)')).toBe(7));
  test('no args #ERR', () => expect(errc('=IFERROR()')).toBe('#ERR'));
});

describe('IFNA', () => {
  test('catches #N/A', () =>
    expect(ok('=IFNA(MATCH("z",A1:A2,0),"missing")', { '0:0': 'a', '1:0': 'b' })).toBe('missing'));
  test('does NOT catch #DIV/0 (propagates)', () => expect(errc('=IFNA(1/0,"x")')).toBe('#DIV/0'));
  test('passes through a value', () => expect(ok('=IFNA(5,"x")')).toBe(5));
  test('requires exactly 2 args', () => {
    expect(errc('=IFNA(5)')).toBe('#ERR');
    expect(errc('=IFNA(5,1,2)')).toBe('#ERR');
  });
});

describe('COUNTA', () => {
  test('counts text and numbers, skips blanks', () =>
    expect(ok('=COUNTA(A1:A4)', { '0:0': 'hello', '1:0': '0', '3:0': 'x' })).toBe(3));
  test('counts errors', () =>
    expect(ok('=COUNTA(A1:A2)', { '0:0': '=1/0', '1:0': 'x' })).toBe(2));
  test('counts booleans', () =>
    expect(ok('=COUNTA(A1:A2)', { '0:0': '=1=1' })).toBe(1));
  test('all blank is 0', () => expect(ok('=COUNTA(A1:A3)')).toBe(0));
  test('scalar args count', () => expect(ok('=COUNTA(1,"a",2)')).toBe(3));
});

describe('COUNTBLANK', () => {
  test('counts empty cells in a range', () =>
    expect(ok('=COUNTBLANK(A1:A4)', { '0:0': 'a', '2:0': 'b' })).toBe(2));
  test('no blanks is 0', () =>
    expect(ok('=COUNTBLANK(A1:A2)', { '0:0': '1', '1:0': '2' })).toBe(0));
  test('all blank counts them all', () => expect(ok('=COUNTBLANK(A1:A3)')).toBe(3));
});

describe('TEXT', () => {
  // Fixed decimals.
  test("'0.00' fixed decimals", () => expect(ok('=TEXT(3.14159,"0.00")')).toBe('3.14'));
  test("'0.00' pads", () => expect(ok('=TEXT(5,"0.00")')).toBe('5.00'));
  test("'0' rounds to integer", () => expect(ok('=TEXT(3.7,"0")')).toBe('4'));
  // Thousands grouping.
  test("'#,##0' grouping", () => expect(ok('=TEXT(1234567,"#,##0")')).toBe('1,234,567'));
  test("'#,##0.00' grouping + decimals", () => expect(ok('=TEXT(1234.5,"#,##0.00")')).toBe('1,234.50'));
  // Percent.
  test("'0%'", () => expect(ok('=TEXT(0.5,"0%")')).toBe('50%'));
  test("'0%' small", () => expect(ok('=TEXT(0.05,"0%")')).toBe('5%'));
  test("'0.00%'", () => expect(ok('=TEXT(0.125,"0.00%")')).toBe('12.50%'));
  // Currency.
  test("'$#,##0.00'", () => expect(ok('=TEXT(1234.5,"$#,##0.00")')).toBe('$1,234.50'));
  test("'$#,##0.00' negative keeps sign before $", () =>
    expect(ok('=TEXT(-1234.5,"$#,##0.00")')).toBe('-$1,234.50'));
  // Dates.
  test("'yyyy-mm-dd'", () => expect(ok('=TEXT(DATE(2024,3,7),"yyyy-mm-dd")')).toBe('2024-03-07'));
  test("'mm/dd/yyyy'", () => expect(ok('=TEXT(DATE(2024,3,7),"mm/dd/yyyy")')).toBe('03/07/2024'));
  test("'m/d/yyyy'", () => expect(ok('=TEXT(DATE(2024,3,7),"m/d/yyyy")')).toBe('3/7/2024'));
  // Fallback for unrecognized patterns.
  test('unrecognized pattern stringifies the value', () => expect(ok('=TEXT(42,"blah")')).toBe('42'));
  test('error value propagates', () => expect(errc('=TEXT(1/0,"0.00")')).toBe('#DIV/0'));
});

describe('SUMPRODUCT', () => {
  test('two parallel ranges', () =>
    expect(ok('=SUMPRODUCT(A1:A3,B1:B3)', {
      '0:0': '1', '1:0': '2', '2:0': '3', '0:1': '4', '1:1': '5', '2:1': '6',
    })).toBe(32)); // 1*4 + 2*5 + 3*6
  test('single range reduces to SUM', () =>
    expect(ok('=SUMPRODUCT(A1:A3)', { '0:0': '1', '1:0': '2', '2:0': '3' })).toBe(6));
  test('three ranges', () =>
    expect(ok('=SUMPRODUCT(A1:A2,B1:B2,C1:C2)', {
      '0:0': '1', '1:0': '2', '0:1': '3', '1:1': '4', '0:2': '5', '1:2': '6',
    })).toBe(63)); // 1*3*5 + 2*4*6
  test('non-numeric cells count as 0', () =>
    expect(ok('=SUMPRODUCT(A1:A3,B1:B3)', {
      '0:0': '1', '1:0': 'x', '2:0': '3', '0:1': '4', '1:1': '5', '2:1': '6',
    })).toBe(22)); // 1*4 + 0*5 + 3*6
  test('shape mismatch is #VALUE', () =>
    expect(errc('=SUMPRODUCT(A1:A3,B1:B2)', { '0:0': '1', '1:0': '2', '2:0': '3', '0:1': '4', '1:1': '5' }))
      .toBe('#VALUE'));
  test('error cell propagates', () =>
    expect(errc('=SUMPRODUCT(A1:A2,B1:B2)', { '0:0': '=1/0', '1:0': '2', '0:1': '3', '1:1': '4' }))
      .toBe('#DIV/0'));
  test('scalar args multiply', () => expect(ok('=SUMPRODUCT(2,3)')).toBe(6));
});

describe('ROUNDUP / ROUNDDOWN', () => {
  test('ROUNDUP away from zero (default 0 dp)', () => expect(ok('=ROUNDUP(2.1)')).toBe(3));
  test('ROUNDDOWN toward zero (default 0 dp)', () => expect(ok('=ROUNDDOWN(2.9)')).toBe(2));
  test('ROUNDUP negative rounds away', () => expect(ok('=ROUNDUP(-2.1)')).toBe(-3));
  test('ROUNDDOWN negative rounds toward', () => expect(ok('=ROUNDDOWN(-2.9)')).toBe(-2));
  test('ROUNDUP with decimals', () => expect(ok('=ROUNDUP(2.001,2)')).toBe(2.01));
  test('ROUNDDOWN with decimals', () => expect(ok('=ROUNDDOWN(2.675,2)')).toBe(2.67));
  test('ROUNDUP(2.5)=3', () => expect(ok('=ROUNDUP(2.5)')).toBe(3));
  test('ROUNDDOWN(2.5)=2', () => expect(ok('=ROUNDDOWN(2.5)')).toBe(2));
  test('ROUNDUP negative digits', () => expect(ok('=ROUNDUP(1234,-2)')).toBe(1300));
  test('ROUNDDOWN negative digits', () => expect(ok('=ROUNDDOWN(1289,-2)')).toBe(1200));
  test('no float-noise false positive', () => expect(ok('=ROUNDUP(0.29,2)')).toBe(0.29));
  test('non-numeric #ERR', () => expect(errc('=ROUNDUP("x")')).toBe('#ERR'));
});

describe('POWER', () => {
  test('basic', () => expect(ok('=POWER(2,10)')).toBe(1024));
  test('negative exponent', () => expect(ok('=POWER(2,-2)')).toBe(0.25));
  test('fractional exponent', () => expect(ok('=POWER(9,0.5)')).toBe(3));
  test('coerces numeric strings like ^', () => expect(ok('=POWER("2",3)')).toBe(8));
  test('matches the ^ operator', () => expect(ok('=POWER(2,3)')).toBe(ok('=2^3')));
  test('non-numeric #ERR', () => expect(errc('=POWER("x",2)')).toBe('#ERR'));
  test('wrong arg count #ERR', () => expect(errc('=POWER(2)')).toBe('#ERR'));
});

describe('MOD', () => {
  test('positive', () => expect(ok('=MOD(5,3)')).toBe(2));
  test('negative dividend takes divisor sign (Google): MOD(-3,2)=1', () =>
    expect(ok('=MOD(-3,2)')).toBe(1));
  test('negative divisor: MOD(3,-2)=-1', () => expect(ok('=MOD(3,-2)')).toBe(-1));
  test('fractional', () => expect(ok('=MOD(5.5,2)')).toBe(1.5));
  test('by zero is #DIV/0', () => expect(errc('=MOD(5,0)')).toBe('#DIV/0'));
});

describe('XLOOKUP', () => {
  const table = { '0:0': 'Alice', '0:1': '30', '1:0': 'Bob', '1:1': '25', '2:0': 'Carol', '2:1': '40' };
  test('exact match returns parallel result', () =>
    expect(ok('=XLOOKUP("Bob",A1:A3,B1:B3)', table)).toBe(25));
  test('case-insensitive key', () => expect(ok('=XLOOKUP("bob",A1:A3,B1:B3)', table)).toBe(25));
  test('numeric key', () =>
    expect(ok('=XLOOKUP(2,A1:A3,B1:B3)', {
      '0:0': '1', '1:0': '2', '2:0': '3', '0:1': 'a', '1:1': 'b', '2:1': 'c',
    })).toBe('b'));
  test('not found defaults to #N/A', () => expect(errc('=XLOOKUP("Zed",A1:A3,B1:B3)', table)).toBe('#N/A'));
  test('not found returns ifNotFound', () =>
    expect(ok('=XLOOKUP("Zed",A1:A3,B1:B3,"none")', table)).toBe('none'));
  test('ifNotFound is lazy — not evaluated on a hit', () =>
    expect(ok('=XLOOKUP("Bob",A1:A3,B1:B3,1/0)', table)).toBe(25));
  test('row-oriented ranges', () =>
    expect(ok('=XLOOKUP("b",A1:C1,A2:C2)', {
      '0:0': 'a', '0:1': 'b', '0:2': 'c', '1:0': '1', '1:1': '2', '1:2': '3',
    })).toBe(2));
  test('size mismatch is #VALUE', () =>
    expect(errc('=XLOOKUP("Bob",A1:A3,B1:B2)', table)).toBe('#VALUE'));
});

describe('VLOOKUP approximate (4th arg)', () => {
  // First column sorted ASCENDING, as approximate match requires.
  const sorted = { '0:0': '1', '0:1': 'low', '1:0': '5', '1:1': 'mid', '2:0': '10', '2:1': 'high' };
  test('default is approximate (largest value <= key)', () =>
    expect(ok('=VLOOKUP(7,A1:B3,2)', sorted)).toBe('mid')); // largest <=7 is 5 -> "mid"
  test('explicit TRUE approximate', () => expect(ok('=VLOOKUP(7,A1:B3,2,TRUE)', sorted)).toBe('mid'));
  test('approximate exact-on-boundary', () => expect(ok('=VLOOKUP(5,A1:B3,2)', sorted)).toBe('mid'));
  test('approximate above the top uses the last row', () =>
    expect(ok('=VLOOKUP(100,A1:B3,2)', sorted)).toBe('high'));
  test('approximate below the bottom is #N/A', () => expect(errc('=VLOOKUP(0,A1:B3,2)', sorted)).toBe('#N/A'));
  test('FALSE forces exact — no exact 7 is #N/A', () =>
    expect(errc('=VLOOKUP(7,A1:B3,2,FALSE)', sorted)).toBe('#N/A'));
  test('FALSE exact hit', () => expect(ok('=VLOOKUP(5,A1:B3,2,FALSE)', sorted)).toBe('mid'));
});

describe('MATCH match_type', () => {
  const asc = { '0:0': '1', '1:0': '3', '2:0': '5', '3:0': '7' };  // ascending
  const desc = { '0:0': '7', '1:0': '5', '2:0': '3', '3:0': '1' }; // descending

  // Default (omitted) match_type stays EXACT in this engine (Google's own
  // default is 1; the engine keeps exact-when-omitted for compatibility).
  test('default is exact — no exact 4 is #N/A', () => expect(errc('=MATCH(4,A1:A4)', asc)).toBe('#N/A'));
  test('default exact hit', () => expect(ok('=MATCH(5,A1:A4)', asc)).toBe(3));
  test('explicit type 0 exact', () => expect(ok('=MATCH(5,A1:A4,0)', asc)).toBe(3));

  // Type 1: largest value <= key, range ascending.
  test('type 1 largest <= key', () => expect(ok('=MATCH(4,A1:A4,1)', asc)).toBe(2)); // 3 at pos 2
  test('type 1 exact boundary', () => expect(ok('=MATCH(7,A1:A4,1)', asc)).toBe(4));
  test('type 1 below all is #N/A', () => expect(errc('=MATCH(0,A1:A4,1)', asc)).toBe('#N/A'));

  // Type -1: smallest value >= key, range descending.
  test('type -1 smallest >= key', () => expect(ok('=MATCH(4,A1:A4,-1)', desc)).toBe(2)); // 5 at pos 2
  test('type -1 rounds up to top', () => expect(ok('=MATCH(6,A1:A4,-1)', desc)).toBe(1)); // 7 at pos 1
  test('type -1 above all still matches lowest', () =>
    expect(ok('=MATCH(0,A1:A4,-1)', desc)).toBe(4)); // smallest >=0 is 1 at pos 4
  test('type -1 above the max is #N/A', () => expect(errc('=MATCH(8,A1:A4,-1)', desc)).toBe('#N/A'));
});
