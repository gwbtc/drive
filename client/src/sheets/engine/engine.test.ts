// CalcEngine evaluation tests. Ports the *correctness* cases from the legacy
// formula.test.ts (adapted to CellId keys) and adds tests for every fixed
// "arguably buggy" behaviour, the new operators/refs, sheet-qualified refs,
// sheets lifecycle, circular detection, and volatiles.

import { describe, expect, test } from 'bun:test';
import { CalcEngine } from './engine';
import { type Scalar, isErr } from './types';

// A far-away target cell so it never collides with the fixtures a test seeds.
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
function disp(raw: string, cells: Record<string, string> = {}): string {
  return build(raw, cells).getDisplay(TARGET);
}

// -----------------------------------------------------------------------------

describe('raw value passthrough', () => {
  test('plain text', () => expect(ok('hello')).toBe('hello'));
  test('empty stays blank', () => expect(val('')).toBe(''));
  test('numeric strings become numbers', () => {
    expect(ok('42')).toBe(42);
    expect(ok('-3.5')).toBe(-3.5);
  });
  test('padded number trimmed', () => expect(ok(' 42 ')).toBe(42));
  test('text keeps surrounding whitespace', () => expect(ok('  hello  ')).toBe('  hello  '));
  test('".5" (no leading digit) stays a string', () => expect(ok('.5')).toBe('.5'));
  test('"1+2" without = is not evaluated', () => expect(ok('1+2')).toBe('1+2'));
  test('ISO date becomes a Date', () => {
    const v = ok('2024-01-15');
    expect(v).toBeInstanceOf(Date);
    expect((v as Date).toISOString()).toBe('2024-01-15T00:00:00.000Z');
  });
});

describe('display formatting', () => {
  test('integers', () => expect(disp('=100')).toBe('100'));
  test('trailing zeros stripped', () => expect(disp('=2.5')).toBe('2.5'));
  test('float noise cleaned', () => expect(disp('=0.1+0.2')).toBe('0.3'));
  // FIX #14: small magnitudes keep precision instead of collapsing to "0".
  test('0.001 does not display as 0', () => expect(disp('=0.001')).toBe('0.001'));
  test('booleans render TRUE/FALSE', () => {
    expect(disp('=1=1')).toBe('TRUE');
    expect(disp('=1<>1')).toBe('FALSE');
  });
  test('dates render ISO', () => expect(disp('=DATE(2024,1,15)')).toBe('2024-01-15'));
  test('errors render their code', () => expect(disp('=1/0')).toBe('#DIV/0'));
  test('getValue stays exact even when display rounds noise', () => {
    // getValue is the raw IEEE value; only getDisplay cleans it.
    expect(ok('=0.1+0.2')).toBeCloseTo(0.3, 15);
    expect(ok('=0.1+0.2')).not.toBe(0.3);
  });
});

describe('arithmetic', () => {
  test('addition', () => expect(ok('=1+2')).toBe(3));
  test('mul before add', () => expect(ok('=1+2*3')).toBe(7));
  test('parens', () => expect(ok('=(1+2)*3')).toBe(9));
  test('division fraction', () => expect(ok('=10/4')).toBe(2.5));
  test('sub left-assoc', () => expect(ok('=10-2-3')).toBe(5));
  test('div left-assoc', () => expect(ok('=100/5/2')).toBe(10));
  test('unary minus', () => expect(ok('=-3+5')).toBe(2));
  test('unary minus after op', () => expect(ok('=2*-3')).toBe(-6));
  test('double unary minus', () => expect(ok('=--5')).toBe(5));
  test('leading-dot literal', () => expect(ok('=.5')).toBe(0.5));
  test('unary minus coerces numeric strings', () => expect(ok('=-"3"')).toBe(-3));
});

describe('new operators', () => {
  test('& concatenates', () => expect(ok('="a"&"b"&1')).toBe('ab1'));
  test('& renders numbers/booleans', () => expect(ok('=1&(1=1)')).toBe('1TRUE'));
  test('^ power', () => expect(ok('=2^10')).toBe(1024));
  test('^ right-assoc', () => expect(ok('=2^3^2')).toBe(512));
  test('unary minus looser than power (Google): -2^2 = -4', () => expect(ok('=-2^2')).toBe(-4));
  test('signed exponent', () => expect(ok('=2^-2')).toBe(0.25));
  test('postfix percent', () => expect(ok('=50%')).toBe(0.5));
  test('percent in arithmetic', () => expect(ok('=200*10%')).toBe(20));
});

describe('string/number coercion', () => {
  test('numeric strings coerce in arithmetic', () => expect(ok('="2"+"3"')).toBe(5));
  // FIX #8: non-numeric text in arithmetic errors (no parseFloat prefix).
  test('"2abc"+1 is an error, not 3', () => expect(errc('="2abc"+1')).toBe('#ERR'));
  test('fully non-numeric strings error', () => expect(errc('="a"+"b"')).toBe('#ERR'));
  test('booleans coerce to 0/1', () => expect(ok('=(1<2)+1')).toBe(2));
});

describe('comparisons', () => {
  test('< and >', () => { expect(ok('=1<2')).toBe(true); expect(ok('=3>4')).toBe(false); });
  test('<= and >=', () => { expect(ok('=2<=2')).toBe(true); expect(ok('=1>=2')).toBe(false); });
  test('= and <>', () => { expect(ok('=1=1')).toBe(true); expect(ok('=1<>1')).toBe(false); });
  test('compare binds looser than arithmetic', () => expect(ok('=1+1=2')).toBe(true));
  test('operator = string equality is case-sensitive', () => {
    expect(ok('="a"="a"')).toBe(true);
    expect(ok('="a"="A"')).toBe(false);
  });
  test('number/string equality coerces', () => expect(ok('="5"=5')).toBe(true));
  test('relational on non-numeric strings errors', () => expect(errc('="a">"b"')).toBe('#ERR'));
  // KEPT #12 (documented): comparisons chain left-to-right with coercion.
  test('chained comparison coerces intermediate boolean (kept)', () => expect(ok('=1<2<3')).toBe(true));
});

describe('cell references', () => {
  test('A1 => 0:0', () => expect(ok('=A1', { '0:0': '5' })).toBe(5));
  test('B3 => 2:1', () => expect(ok('=B3', { '2:1': '7' })).toBe(7));
  test('case-insensitive', () => expect(ok('=a1+b1', { '0:0': '1', '0:1': '2' })).toBe(3));
  test('AA1 => 0:26', () => expect(ok('=AA1', { '0:26': '9' })).toBe(9));
  test('empty ref in arithmetic is 0', () => expect(ok('=A1+1')).toBe(1));
  test('bare ref to empty cell is blank', () => expect(val('=A1')).toBe(''));
  test('ref to text', () => expect(ok('=A1', { '0:0': 'hi' })).toBe('hi'));
  test('recursive formula refs', () => expect(ok('=A1+1', { '0:0': '=B1+1', '0:1': '2' })).toBe(4));
  // FIX #4: absolute refs are supported and behave like relative for eval.
  test('$A$1 resolves', () => expect(ok('=$A$1', { '0:0': '5' })).toBe(5));
  test('mixed $A1 / A$1 resolve', () => expect(ok('=$A1+A$1', { '0:0': '4' })).toBe(8));
  test('A0 is #REF', () => expect(errc('=A0')).toBe('#REF'));
});

describe('ranges', () => {
  test('bare range as scalar errors', () => expect(errc('=A1:B2', { '0:0': '1' })).toBe('#ERR'));
  test('range in arithmetic errors', () => expect(errc('=A1:B2+1', { '0:0': '1' })).toBe('#ERR'));
  test('reversed corners normalize', () => expect(ok('=SUM(B2:A1)', { '0:0': '1', '1:1': '2' })).toBe(3));
  test('2D range covers rectangle', () =>
    expect(ok('=SUM(A1:B2)', { '0:0': '1', '0:1': '2', '1:0': '3', '1:1': '4' })).toBe(10));
});

describe('SUM', () => {
  test('scalar args', () => expect(ok('=SUM(1,2,3)')).toBe(6));
  test('no args is 0', () => expect(ok('=SUM()')).toBe(0));
  test('mixes scalars and ranges', () => expect(ok('=SUM(1,A1:A2)', { '0:0': '2', '1:0': '3' })).toBe(6));
  test('empty cells skipped', () => expect(ok('=SUM(A1:A4)', { '0:0': '1', '3:0': '4' })).toBe(5));
  test('text skipped', () => expect(ok('=SUM(A1:A2)', { '0:0': 'abc', '1:0': '3' })).toBe(3));
  // FIX #8: SUM ignores digit-prefixed text entirely (Excel/Sheets behaviour).
  test('digit-prefixed text contributes nothing', () =>
    expect(ok('=SUM(A1:A2)', { '0:0': '2abc', '1:0': '3' })).toBe(3));
  test('errors propagate', () => expect(errc('=SUM(A1:A2)', { '0:0': '=1/0', '1:0': '1' })).toBe('#DIV/0'));
});

describe('AVG / AVERAGE', () => {
  test('averages', () => expect(ok('=AVG(1,2,6)')).toBe(3));
  test('AVERAGE alias', () => expect(ok('=AVERAGE(2,4)')).toBe(3));
  test('empty excluded from count', () => expect(ok('=AVERAGE(A1:A4)', { '0:0': '2', '2:0': '4' })).toBe(3));
  test('empty average is #DIV/0', () => expect(errc('=AVG(A1:A3)')).toBe('#DIV/0'));
});

describe('MIN / MAX', () => {
  test('MIN', () => expect(ok('=MIN(A1:A3)', { '0:0': '5', '1:0': '-2', '2:0': '3' })).toBe(-2));
  test('MAX', () => expect(ok('=MAX(A1:A2)', { '0:0': '-5', '1:0': '-2' })).toBe(-2));
  test('mixed args', () => expect(ok('=MIN(3,A1:A2,-1)', { '0:0': '0' })).toBe(-1));
  test('empty range MIN/MAX is 0 (kept)', () => {
    expect(ok('=MIN(A1:A2)')).toBe(0);
    expect(ok('=MAX(A1:A2)')).toBe(0);
  });
});

describe('COUNT', () => {
  test('counts numbers', () => expect(ok('=COUNT(A1:A4)', { '0:0': '1', '1:0': 'abc', '2:0': '3' })).toBe(2));
  test('errors skipped', () => expect(ok('=COUNT(A1:A3)', { '0:0': '=1/0', '1:0': '5', '2:0': 'abc' })).toBe(1));
  test('numeric scalar/string args count', () => expect(ok('=COUNT(1,"abc","5")')).toBe(2));
  // FIX #9: empty string is not a number.
  test('COUNT("") is 0', () => expect(ok('=COUNT("")')).toBe(0));
});

describe('IF (lazy)', () => {
  test('true branch', () => expect(ok('=IF(1<2,"yes","no")')).toBe('yes'));
  test('false branch', () => expect(ok('=IF(2<1,"yes","no")')).toBe('no'));
  test('numeric truthiness', () => {
    expect(ok('=IF("1","y","n")')).toBe('y');
    expect(ok('=IF("abc",1,2)')).toBe(2);
  });
  test('missing else is blank', () => expect(ok('=IF(0,1)')).toBe(''));
  test('one arg errors', () => expect(errc('=IF(0)')).toBe('#ERR'));
  test('only chosen branch evaluated', () => expect(ok('=IF(1,2,1/0)')).toBe(2));
});

describe('date functions', () => {
  test('TODAY midnight UTC', () => {
    const d = ok('=TODAY()') as Date;
    expect(d).toBeInstanceOf(Date);
    expect(d.getUTCHours()).toBe(0);
  });
  test('NOW is a Date', () => expect(ok('=NOW()')).toBeInstanceOf(Date));
  test('DATE builds UTC', () => expect(disp('=DATE(2024,1,15)')).toBe('2024-01-15'));
  test('DATE month overflow', () => expect(disp('=DATE(2024,13,1)')).toBe('2025-01-01'));
  test('YEAR/MONTH/DAY roundtrip', () => {
    expect(ok('=YEAR(DATE(2024,2,29))')).toBe(2024);
    expect(ok('=MONTH(DATE(2024,2,29))')).toBe(2);
    expect(ok('=DAY(DATE(2024,2,29))')).toBe(29);
  });
  test('YEAR of a date string', () => expect(ok('=YEAR("2024-03-05")')).toBe(2024));
  test('DAY of an ISO cell', () => expect(ok('=DAY(A1)', { '0:0': '2024-03-05' })).toBe(5));
  test('YEAR(0) is epoch', () => expect(ok('=YEAR(0)')).toBe(1970));
  test('DATE needs 3 args', () => expect(errc('=DATE(2024,1)')).toBe('#ERR'));
});

describe('ABS / ROUND / SQRT', () => {
  test('ABS', () => { expect(ok('=ABS(-5)')).toBe(5); expect(ok('=ABS(5)')).toBe(5); });
  test('ABS non-numeric errors', () => expect(errc('=ABS("x")')).toBe('#ERR'));
  test('ROUND default 0 dp', () => expect(ok('=ROUND(2.567)')).toBe(3));
  test('ROUND with dp', () => expect(ok('=ROUND(2.567,2)')).toBe(2.57));
  test('ROUND negative dp', () => expect(ok('=ROUND(1234.5678,-2)')).toBe(1200));
  // FIX #6: halves round away from zero.
  test('ROUND(-2.5) is -3', () => expect(ok('=ROUND(-2.5)')).toBe(-3));
  test('ROUND(2.5) is 3', () => expect(ok('=ROUND(2.5)')).toBe(3));
  test('ROUND(-3.5) is -4', () => expect(ok('=ROUND(-3.5)')).toBe(-4));
  // Bug 3: ROUND normalizes float noise like ROUNDUP/ROUNDDOWN. Without the
  // toPrecision(15) pass these round DOWN (1.005*100 = 100.4999…, 2.675*100 =
  // 267.4999…) and yield 1 / 2.67.
  test('ROUND(1.005,2) is 1.01 (float noise cleaned)', () => expect(ok('=ROUND(1.005,2)')).toBe(1.01));
  test('ROUND(2.675,2) is 2.68 (float noise cleaned)', () => expect(ok('=ROUND(2.675,2)')).toBe(2.68));
  test('SQRT', () => expect(ok('=SQRT(9)')).toBe(3));
  test('SQRT negative errors', () => expect(errc('=SQRT(-1)')).toBe('#ERR'));
  test('SQRT numeric string', () => expect(ok('=SQRT("16")')).toBe(4));
});

describe('string functions', () => {
  test('LEN string', () => expect(ok('=LEN("hello")')).toBe(5));
  test('LEN number', () => expect(ok('=LEN(123)')).toBe(3));
  // FIX #5: empty cell has length 0, not 1.
  test('LEN of empty cell is 0', () => expect(ok('=LEN(A1)')).toBe(0));
  test('UPPER/LOWER', () => { expect(ok('=UPPER("MiX")')).toBe('MIX'); expect(ok('=LOWER("MiX")')).toBe('mix'); });
  test('TRIM edges only', () => {
    expect(ok('=TRIM("  a b  ")')).toBe('a b');
    expect(ok('=TRIM("a   b")')).toBe('a   b');
  });
  test('LEFT default 1', () => expect(ok('=LEFT("hello")')).toBe('h'));
  test('LEFT count', () => expect(ok('=LEFT("hello",3)')).toBe('hel'));
  test('LEFT 0', () => expect(ok('=LEFT("abc",0)')).toBe(''));
  test('RIGHT count', () => expect(ok('=RIGHT("hello",2)')).toBe('lo'));
  test('RIGHT past length', () => expect(ok('=RIGHT("hi",5)')).toBe('hi'));
  test('MID 1-based', () => expect(ok('=MID("hello",2,3)')).toBe('ell'));
  test('MID clip', () => expect(ok('=MID("hello",1,100)')).toBe('hello'));
  // Bug 5: start < 1 is #VALUE, not a from-the-end slice.
  test('MID start 0 is #VALUE', () => expect(errc('=MID("hello",0,3)')).toBe('#VALUE'));
  test('MID negative start is #VALUE', () => expect(errc('=MID("hello",-2,3)')).toBe('#VALUE'));
  test('CONCATENATE mixed', () => expect(ok('=CONCATENATE("a",1,"b")')).toBe('a1b'));
  test('CONCAT alias / empty', () => { expect(ok('=CONCAT("x","y")')).toBe('xy'); expect(ok('=CONCAT()')).toBe(''); });
  // FIX #13: booleans render UPPERCASE in CONCAT.
  test('CONCAT boolean is TRUE (uppercase)', () => expect(ok('=CONCAT("x",1=1)')).toBe('xTRUE'));
  // Bug 4: numbers embedded in string coercion get the same noise cleaning as
  // the display path. Previously these produced "x0.30000000000000004".
  test('& coercion cleans float noise', () => {
    expect(ok('="x"&(0.1+0.2)')).toBe('x0.3');
    expect(disp('="x"&(0.1+0.2)')).toBe('x0.3');
  });
  test('CONCAT cleans float noise', () => expect(ok('=CONCAT("x",0.1+0.2)')).toBe('x0.3'));
  test('TEXT default stringify cleans float noise', () =>
    expect(ok('=TEXT(0.1+0.2,"blah")')).toBe('0.3'));
});

describe('SUMIF / COUNTIF / AVERAGEIF', () => {
  test('SUMIF numeric criterion', () =>
    expect(ok('=SUMIF(A1:A3,">2")', { '0:0': '1', '1:0': '5', '2:0': '10' })).toBe(15));
  test('SUMIF separate sum range', () =>
    expect(ok('=SUMIF(A1:A3,"a",B1:B3)', {
      '0:0': 'a', '1:0': 'b', '2:0': 'a', '0:1': '1', '1:1': '2', '2:1': '3',
    })).toBe(4));
  // FIX #1: sum range stays positionally parallel across blank test cells.
  test('SUMIF keeps sum range aligned when test cells are blank', () =>
    expect(ok('=SUMIF(A1:A3,">0",B1:B3)', {
      '0:0': '1', '2:0': '3', '0:1': '10', '1:1': '20', '2:1': '30',
    })).toBe(40));
  // FIX #2: a short sum range extends its SHAPE from its top-left (no fallback
  // to the test cell's own value).
  test('SUMIF extends a short sum range from its top-left', () =>
    expect(ok('=SUMIF(A1:A3,">0",B1:B1)', {
      '0:0': '1', '1:0': '2', '2:0': '3', '0:1': '10',
    })).toBe(10));
  test('COUNTIF equality case-insensitive', () =>
    expect(ok('=COUNTIF(A1:A3,"APPLE")', { '0:0': 'Apple', '1:0': 'apple', '2:0': 'banana' })).toBe(2));
  test('COUNTIF <>x case-insensitive', () =>
    expect(ok('=COUNTIF(A1:A3,"<>x")', { '0:0': 'x', '1:0': 'X', '2:0': 'y' })).toBe(1));
  test('COUNTIF numeric', () => expect(ok('=COUNTIF(A1:A3,2)', { '0:0': '1', '1:0': '2', '2:0': '2' })).toBe(2));
  test('COUNTIF >5', () => expect(ok('=COUNTIF(A1:A3,">5")', { '0:0': '3', '1:0': '7', '2:0': '10' })).toBe(2));
  test('criterion strips quotes from a cell', () =>
    expect(ok('=COUNTIF(A1:A2,B1)', { '0:0': 'foo', '1:0': 'bar', '0:1': '"foo"' })).toBe(1));
  // FIX #11: relational string criteria are case-insensitive too. Case-sensitive
  // ordering would count 0 here; case-insensitive counts BANANA.
  test('relational string criterion is case-insensitive', () =>
    expect(ok('=COUNTIF(A1:A2,">apple")', { '0:0': 'BANANA', '1:0': 'apple' })).toBe(1));
  // FIX #10: an empty criterion matches truly-blank cells.
  test('COUNTIF "" matches blanks', () =>
    expect(ok('=COUNTIF(A1:A3,"")', { '0:0': 'a', '2:0': 'b' })).toBe(1));
  // FIX #7: doubled-quote escaping means the Excel spelling now works.
  test('doubled-quote criterion parses and evaluates', () =>
    expect(ok('=SUMIF(A1:A2,"<>""x""")', { '0:0': 'x', '1:0': '5' })).toBe(5));
  test('AVERAGEIF', () => expect(ok('=AVERAGEIF(A1:A3,">1")', { '0:0': '1', '1:0': '2', '2:0': '3' })).toBe(2.5));
  test('AVERAGEIF no match is #DIV/0', () => expect(errc('=AVERAGEIF(A1:A2,">9")', { '0:0': '1' })).toBe('#DIV/0'));
});

describe('VLOOKUP', () => {
  const table = { '0:0': 'Alice', '0:1': '30', '1:0': 'Bob', '1:1': '25' };
  test('exact match', () => expect(ok('=VLOOKUP("Bob",A1:B2,2)', table)).toBe(25));
  test('case-insensitive', () => expect(ok('=VLOOKUP("alice",A1:B2,2)', table)).toBe(30));
  test('numeric lookup', () =>
    expect(ok('=VLOOKUP(2,A1:B2,2)', { '0:0': '1', '0:1': 'one', '1:0': '2', '1:1': 'two' })).toBe('two'));
  // Default match mode is approximate (TRUE), Google's default, so an exact
  // no-match must be requested explicitly with FALSE. (Approximate no-match is
  // covered in functions-batch.test.ts.)
  test('exact no match #N/A', () => expect(errc('=VLOOKUP("Zed",A1:B2,2,FALSE)', table)).toBe('#N/A'));
  test('column beyond width #REF', () => expect(errc('=VLOOKUP("Alice",A1:B2,3)', table)).toBe('#REF'));
  test('second arg must be a range', () => expect(errc('=VLOOKUP("a",A1,2)', { '0:0': 'a' })).toBe('#REF'));
});

describe('INDEX', () => {
  const cells = { '0:0': 'a', '0:1': 'b', '1:0': 'c', '1:1': 'd' };
  test('1-based row/col', () => expect(ok('=INDEX(A1:B2,2,2)', cells)).toBe('d'));
  test('column defaults to 1', () => expect(ok('=INDEX(A1:A3,2)', { '0:0': 'x', '1:0': 'y', '2:0': 'z' })).toBe('y'));
  test('out-of-bounds row #REF', () => expect(errc('=INDEX(A1:B2,3,1)', cells)).toBe('#REF'));
  test('row 0 #ERR', () => expect(errc('=INDEX(A1:B2,0,1)', cells)).toBe('#ERR'));
  test('empty cell yields blank', () => expect(ok('=INDEX(A1:A2,2)', { '0:0': 'x' })).toBe(''));
  test('errors propagate', () => expect(errc('=INDEX(A1:A2,2)', { '0:0': '1', '1:0': '=1/0' })).toBe('#DIV/0'));
});

describe('MATCH', () => {
  test('1-based position', () => expect(ok('=MATCH("b",A1:A3)', { '0:0': 'a', '1:0': 'b', '2:0': 'c' })).toBe(2));
  test('case-insensitive', () => expect(ok('=MATCH("B",A1:A3)', { '0:0': 'a', '1:0': 'b', '2:0': 'c' })).toBe(2));
  test('no match #N/A', () => expect(errc('=MATCH("z",A1:A3)', { '0:0': 'a', '1:0': 'b' })).toBe('#N/A'));
  // FIX #3: blanks count toward the position.
  test('blank cells count toward the position', () =>
    expect(ok('=MATCH("b",A1:A3)', { '0:0': 'a', '2:0': 'b' })).toBe(3));
});

describe('errors', () => {
  test('div by zero', () => expect(errc('=1/0')).toBe('#DIV/0'));
  test('div by empty cell', () => expect(errc('=A1/B1', { '0:0': '4' })).toBe('#DIV/0'));
  test('div by "0"', () => expect(errc('=5/"0"')).toBe('#DIV/0'));
  test('errors propagate through arithmetic', () => expect(errc('=1+A1', { '0:0': '=1/0' })).toBe('#DIV/0'));
  test('unknown function #NAME', () => expect(errc('=FOO(1)')).toBe('#NAME'));
  test('bare identifier #ERR', () => expect(errc('=FOO')).toBe('#ERR'));
  test('= alone #ERR', () => expect(errc('=')).toBe('#ERR'));
  test('trailing tokens #ERR', () => expect(errc('=1 2')).toBe('#ERR'));
  test('unknown char #ERR', () => expect(errc('=@')).toBe('#ERR'));
  test('unbalanced paren #ERR', () => expect(errc('=(1')).toBe('#ERR'));
  // FIX #7: unterminated string is now a parse error (was silently accepted).
  test('unterminated string is #ERR', () => expect(errc('="abc')).toBe('#ERR'));
  test('error literal in a formula surfaces', () => expect(errc('=#REF!')).toBe('#REF'));
});

describe('circular references', () => {
  const engineWith = (cells: Record<string, string>) => {
    const e = new CalcEngine();
    e.addSheet('S');
    e.setCells(Object.entries(cells).map(([k, v]) => ({ id: `S!${k}`, raw: v })));
    return e;
  };
  test('self reference', () => {
    const e = engineWith({ '0:0': '=A1' });
    expect(e.getValue('S!0:0')).toEqual({ err: '#CIRCULAR' });
  });
  test('two-cell cycle', () => {
    const e = engineWith({ '0:0': '=B1', '0:1': '=A1' });
    expect(e.getValue('S!0:0')).toEqual({ err: '#CIRCULAR' });
    expect(e.getValue('S!0:1')).toEqual({ err: '#CIRCULAR' });
  });
  test('cycle through a range aggregate', () => {
    const e = engineWith({ '0:0': '=SUM(A1:A2)', '1:0': '1' });
    expect(e.getValue('S!0:0')).toEqual({ err: '#CIRCULAR' });
  });
  test('breaking a cycle recovers', () => {
    const e = engineWith({ '0:0': '=B1', '0:1': '=A1' });
    e.setCells([{ id: 'S!0:1', raw: '5' }]);
    expect(e.getValue('S!0:0')).toBe(5);
    expect(e.getValue('S!0:1')).toBe(5);
  });
});

describe('sheet-qualified evaluation', () => {
  const two = () => {
    const e = new CalcEngine();
    e.addSheet('Sheet1');
    e.addSheet('Sheet2');
    return e;
  };
  test('cross-sheet reference resolves', () => {
    const e = two();
    e.setCells([{ id: 'Sheet2!0:0', raw: '42' }, { id: 'Sheet1!0:0', raw: '=Sheet2!A1+1' }]);
    expect(e.getValue('Sheet1!0:0')).toBe(43);
  });
  test('cross-sheet range', () => {
    const e = two();
    e.setCells([
      { id: 'Sheet2!0:0', raw: '1' }, { id: 'Sheet2!1:0', raw: '2' },
      { id: 'Sheet1!0:0', raw: '=SUM(Sheet2!A1:A2)' },
    ]);
    expect(e.getValue('Sheet1!0:0')).toBe(3);
  });
  test('quoted sheet name resolves', () => {
    const e = new CalcEngine();
    e.addSheet('Q3 Budget');
    e.addSheet('Sheet1');
    e.setCells([{ id: 'Q3 Budget!0:0', raw: '7' }, { id: 'Sheet1!0:0', raw: "='Q3 Budget'!A1*2" }]);
    expect(e.getValue('Sheet1!0:0')).toBe(14);
  });
  test('editing a source cell repaints its cross-sheet dependent', () => {
    const e = two();
    e.setCells([{ id: 'Sheet2!0:0', raw: '10' }, { id: 'Sheet1!0:0', raw: '=Sheet2!A1' }]);
    const repaint = e.setCells([{ id: 'Sheet2!0:0', raw: '20' }]);
    expect(repaint.has('Sheet1!0:0')).toBe(true);
    expect(e.getValue('Sheet1!0:0')).toBe(20);
  });
});

describe('sheet lifecycle', () => {
  test('renameSheet rewrites qualified refs and preserves values', () => {
    const e = new CalcEngine();
    e.addSheet('Sheet1');
    e.addSheet('Data');
    e.setCells([{ id: 'Data!0:0', raw: '5' }, { id: 'Sheet1!0:0', raw: '=Data!A1*2' }]);
    e.renameSheet('Data', 'Numbers');
    expect(e.getValue('Sheet1!0:0')).toBe(10);
    // The cell now lives under the new sheet id and still recomputes.
    e.setCells([{ id: 'Numbers!0:0', raw: '8' }]);
    expect(e.getValue('Sheet1!0:0')).toBe(16);
  });
  test('renameSheet moves local cells and keeps unqualified refs working', () => {
    const e = new CalcEngine();
    e.addSheet('Old');
    e.setCells([{ id: 'Old!0:0', raw: '3' }, { id: 'Old!0:1', raw: '=A1+1' }]);
    e.renameSheet('Old', 'New');
    expect(e.getValue('New!0:1')).toBe(4);
    e.setCells([{ id: 'New!0:0', raw: '10' }]);
    expect(e.getValue('New!0:1')).toBe(11);
  });
  test('removeSheet drops cells and recomputes dependents to #REF', () => {
    const e = new CalcEngine();
    e.addSheet('Sheet1');
    e.addSheet('Data');
    e.setCells([{ id: 'Data!0:0', raw: '5' }, { id: 'Sheet1!0:0', raw: '=Data!A1+1' }]);
    e.removeSheet('Data');
    expect(e.getValue('Data!0:0')).toBe('');
    // Data no longer exists, so Data!A1 is #REF (not blank) — the arithmetic
    // propagates it. (Bug 2: an unknown sheet is #REF, not silently 0.)
    expect(e.getValue('Sheet1!0:0')).toEqual({ err: '#REF' });
    expect(e.getDisplay('Sheet1!0:0')).toBe('#REF');
  });
  test('reference to a deleted sheet displays #REF, not blank/0', () => {
    const e = new CalcEngine();
    e.addSheet('Sheet1');
    e.addSheet('Sheet2');
    e.setCells([{ id: 'Sheet2!0:0', raw: '5' }, { id: 'Sheet1!0:0', raw: '=Sheet2!A1*2' }]);
    expect(e.getValue('Sheet1!0:0')).toBe(10);
    e.removeSheet('Sheet2');
    expect(e.getValue('Sheet1!0:0')).toEqual({ err: '#REF' });
    // A bare reference to the removed sheet is #REF too.
    e.setCells([{ id: 'Sheet1!0:0', raw: '=Sheet2!A1' }]);
    expect(e.getValue('Sheet1!0:0')).toEqual({ err: '#REF' });
    expect(e.getDisplay('Sheet1!0:0')).toBe('#REF');
  });
  test('reference to a never-added sheet is #REF', () => {
    const e = new CalcEngine();
    e.addSheet('Sheet1');
    e.setCells([{ id: 'Sheet1!0:0', raw: '=Ghost!A1' }]);
    expect(e.getValue('Sheet1!0:0')).toEqual({ err: '#REF' });
  });
  test('reference to a known but empty sheet cell stays blank (not #REF)', () => {
    const e = new CalcEngine();
    e.addSheet('Sheet1');
    e.addSheet('Sheet2');
    e.setCells([{ id: 'Sheet1!0:0', raw: '=Sheet2!A1' }]);
    expect(e.getValue('Sheet1!0:0')).toBe('');
  });
});

describe('volatiles', () => {
  test('recalcVolatiles refreshes NOW() and its dependents', () => {
    const e = new CalcEngine();
    e.addSheet('S');
    e.setCells([{ id: 'S!0:0', raw: '=NOW()' }, { id: 'S!0:1', raw: '=YEAR(A1)' }]);
    const t1 = (e.getValue('S!0:0') as Date).getTime();
    const repaint = e.recalcVolatiles();
    const t2 = (e.getValue('S!0:0') as Date).getTime();
    expect(t2).toBeGreaterThanOrEqual(t1);
    // The volatile cell is a candidate; YEAR(A1) depends on it transitively.
    expect(repaint instanceof Set).toBe(true);
  });
  test('non-volatile sheets are untouched by recalcVolatiles', () => {
    const e = new CalcEngine();
    e.addSheet('S');
    e.setCells([{ id: 'S!0:0', raw: '=1+1' }]);
    expect(e.recalcVolatiles().size).toBe(0);
  });
});

describe('repaint set precision', () => {
  test('only cells whose display changed are returned', () => {
    const e = new CalcEngine();
    e.addSheet('S');
    e.setCells([{ id: 'S!0:0', raw: '5' }, { id: 'S!0:1', raw: '=A1*2' }, { id: 'S!0:2', raw: '=A1>0' }]);
    // A1: 5 -> 6. B1 (10->12) changes; C1 (TRUE->TRUE) does not.
    const repaint = e.setCells([{ id: 'S!0:0', raw: '6' }]);
    expect(repaint.has('S!0:0')).toBe(true);
    expect(repaint.has('S!0:1')).toBe(true);
    expect(repaint.has('S!0:2')).toBe(false);
  });
});
