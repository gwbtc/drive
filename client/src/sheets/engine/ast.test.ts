// Tokenizer / parser / serializer tests. Covers the grammar extensions over
// the legacy formula.ts: absolute refs, sheet-qualified refs, & ^ % operators,
// string escaping, error literals, and serializer round-trips.

import { describe, expect, test } from 'bun:test';
import { parse, serialize, tokenize, colToLabel, labelToCol, type Ast } from './ast';

const ser = (f: string) => serialize(parse(f));
// Semantic round-trip: parse -> serialize -> parse yields an equal AST.
const roundTrips = (f: string) => expect(parse('=' + ser(f))).toEqual(parse(f));

describe('column <-> label', () => {
  test('A/Z/AA/AB', () => {
    expect(colToLabel(0)).toBe('A');
    expect(colToLabel(25)).toBe('Z');
    expect(colToLabel(26)).toBe('AA');
    expect(colToLabel(27)).toBe('AB');
    expect(labelToCol('A')).toBe(0);
    expect(labelToCol('Z')).toBe(25);
    expect(labelToCol('AA')).toBe(26);
  });
});

describe('cell references', () => {
  test('A1 => row 0 col 0, relative', () => {
    expect(parse('=A1')).toEqual({ type: 'cell', row: 0, col: 0, rowAbs: false, colAbs: false, sheet: undefined });
  });

  test('B3 => row 2 col 1', () => {
    const a = parse('=B3');
    expect(a).toMatchObject({ type: 'cell', row: 2, col: 1 });
  });

  test('multi-letter columns AA1 => col 26', () => {
    expect(parse('=AA1')).toMatchObject({ type: 'cell', col: 26, row: 0 });
  });

  test('$A$1 fully absolute', () => {
    expect(parse('=$A$1')).toMatchObject({ type: 'cell', row: 0, col: 0, rowAbs: true, colAbs: true });
  });

  test('$A1 column-absolute, A$1 row-absolute', () => {
    expect(parse('=$A1')).toMatchObject({ colAbs: true, rowAbs: false });
    expect(parse('=A$1')).toMatchObject({ colAbs: false, rowAbs: true });
  });
});

describe('ranges', () => {
  test('A1:B3', () => {
    const a = parse('=A1:B3') as Extract<Ast, { type: 'range' }>;
    expect(a.type).toBe('range');
    expect(a.start).toMatchObject({ row: 0, col: 0 });
    expect(a.end).toMatchObject({ row: 2, col: 1 });
  });

  test('absolute corners preserved per-corner', () => {
    const a = parse('=$A$1:B2') as Extract<Ast, { type: 'range' }>;
    expect(a.start).toMatchObject({ rowAbs: true, colAbs: true });
    expect(a.end).toMatchObject({ rowAbs: false, colAbs: false });
  });
});

describe('sheet-qualified references', () => {
  test('Sheet2!A1', () => {
    expect(parse('=Sheet2!A1')).toMatchObject({ type: 'cell', sheet: 'Sheet2', row: 0, col: 0 });
  });

  test('quoted sheet name with a space', () => {
    const a = parse("='Q3 Budget'!A1:B3") as Extract<Ast, { type: 'range' }>;
    expect(a.type).toBe('range');
    expect(a.sheet).toBe('Q3 Budget');
  });

  test('sheet name that looks like a cell (Sheet2) tokenizes correctly', () => {
    expect(parse('=Sheet2!B2')).toMatchObject({ sheet: 'Sheet2', row: 1, col: 1 });
  });

  test('quoted sheet name with an escaped quote', () => {
    const a = parse("='O''Brien'!A1") as Extract<Ast, { type: 'cell' }>;
    expect(a.sheet).toBe("O'Brien");
  });
});

describe('operators', () => {
  test('& is string concat, looser than +', () => {
    expect(parse('=1+2&3')).toEqual({
      type: 'binary', op: '&',
      left: { type: 'binary', op: '+', left: { type: 'num', value: 1 }, right: { type: 'num', value: 2 } },
      right: { type: 'num', value: 3 },
    });
  });

  test('^ is right-associative', () => {
    const a = parse('=2^3^2') as Extract<Ast, { type: 'binary' }>;
    expect(a.op).toBe('^');
    expect((a.right as Extract<Ast, { type: 'binary' }>).op).toBe('^'); // 2^(3^2)
  });

  test('unary minus binds looser than ^ (Google): -2^2 = -(2^2)', () => {
    const a = parse('=-2^2');
    expect(a).toMatchObject({ type: 'unary', op: '-', expr: { type: 'binary', op: '^' } });
  });

  test('postfix % wraps its operand', () => {
    expect(parse('=50%')).toEqual({ type: 'percent', expr: { type: 'num', value: 50 } });
  });

  test('comparison precedence is loosest', () => {
    const a = parse('=1+1=2') as Extract<Ast, { type: 'binary' }>;
    expect(a.op).toBe('=');
  });
});

describe('literals', () => {
  test('leading-dot number', () => expect(parse('=.5')).toEqual({ type: 'num', value: 0.5 }));
  test('scientific-notation literals', () => {
    expect(parse('=1e21')).toEqual({ type: 'num', value: 1e21 });
    expect(parse('=1.5e-3')).toEqual({ type: 'num', value: 1.5e-3 });
    expect(parse('=1E+21')).toEqual({ type: 'num', value: 1e21 });
    expect(parse('=.5e3')).toEqual({ type: 'num', value: 500 });
  });
  test('TRUE / FALSE booleans', () => {
    expect(parse('=TRUE')).toEqual({ type: 'bool', value: true });
    expect(parse('=FALSE')).toEqual({ type: 'bool', value: false });
  });
  test('string with doubled-quote escape', () => {
    expect(parse('="a""b"')).toEqual({ type: 'str', value: 'a"b' });
  });
  test('error literals parse to err nodes', () => {
    expect(parse('=#REF!')).toEqual({ type: 'err', code: '#REF' });
    expect(parse('=#DIV/0!')).toEqual({ type: 'err', code: '#DIV/0' });
    expect(parse('=#N/A')).toEqual({ type: 'err', code: '#N/A' });
  });
});

describe('parse errors', () => {
  test('unterminated string', () => expect(() => tokenize('"abc')).toThrow());
  test('bare identifier (no parens)', () => expect(() => parse('=FOO')).toThrow());
  test('trailing tokens', () => expect(() => parse('=1 2')).toThrow());
  test('unknown char', () => expect(() => parse('=@')).toThrow());
  test('unbalanced paren', () => expect(() => parse('=(1')).toThrow());
  test('empty formula', () => expect(() => parse('=')).toThrow());
});

describe('serializer round-trips', () => {
  const cases = [
    '=A1', '=$A$1', '=$A1', '=A$1', '=A1:B3', '=$A$1:$B$3',
    '=Sheet2!A1', "='Q3 Budget'!A1:B10", '=Sheet2!A1:B2',
    '=1+2*3', '=(1+2)*3', '=10/4-1', '=-A1', '=--5', '=2*-3',
    '=A1&B1&"x"', '=2^3^2', '=-2^2', '=50%', '=A1*2%',
    '=SUM(A1:A10,B1,2)', '=IF(A1>0,"y","n")', '=VLOOKUP("k",A1:B9,2,FALSE)',
    '=1<2', '=1<>2', '=A1>=B1', '=CONCAT("a","b")', '=#REF!',
  ];
  for (const f of cases) {
    test(f, () => roundTrips(f));
  }

  test('exact serialization of a simple cell', () => {
    expect(ser('=$A$1')).toBe('$A$1');
    expect(ser('=Sheet2!B2')).toBe('Sheet2!B2');
  });

  test('quoted sheet name is re-quoted', () => {
    expect(ser("='Q3 Budget'!A1")).toBe("'Q3 Budget'!A1");
  });

  // Bug 6: String(value) emits exponent form for very large/small magnitudes;
  // without exponent support in NUM_RE the re-parse corrupted the literal
  // (1e+21 -> NUM(1)/IDENT(e)/...). These must survive the round-trip.
  describe('large/small number round-trips', () => {
    const nums = ['=1e21', '=1.5e-3', '=1E+21', '=1e-7', '=1e30', '=123456789012345680000'];
    for (const f of nums) {
      test(f, () => {
        roundTrips(f);
        // The serialized text itself must re-parse without throwing.
        expect(() => parse('=' + ser(f))).not.toThrow();
      });
    }
    test('serialize of 1e21 re-parses to the same value', () => {
      expect(parse('=' + ser('=1e21'))).toEqual({ type: 'num', value: 1e21 });
    });
  });
});
