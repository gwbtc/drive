// Formula grammar: tokenizer -> recursive-descent parser -> AST, plus a
// serializer (AST -> formula string) used for reference rewriting round-trips
// (insert/delete column & row, fill/drag, sheet rename).
//
// Extensions over the legacy formula.ts grammar:
//   * Absolute refs: $A$1, $A1, A$1   (per-axis rowAbs / colAbs flags)
//   * Sheet-qualified refs: Sheet2!A1, 'Q3 Budget'!A1:B3
//   * Operators: & (concat), ^ (power, right-assoc), postfix % (percent)
//   * String literals support "" escaping; unterminated strings are an error.
//   * Boolean literals TRUE / FALSE; error literals (#REF!, #DIV/0!, ...).
//
// Cells are 0-based internally (A1 => row 0 col 0). Everything here is pure.

import type { ErrCode } from './types';

// -----------------------------------------------------------------------------
// AST
// -----------------------------------------------------------------------------

export type BinOp =
  | '+' | '-' | '*' | '/' | '^' | '&'
  | '=' | '<>' | '<' | '>' | '<=' | '>=';

// A cell reference. row/col are 0-based. rowAbs/colAbs record `$` anchoring;
// they affect reference rewriting (refs.ts) but never evaluation.
export interface Corner {
  row: number;
  col: number;
  rowAbs: boolean;
  colAbs: boolean;
}

export type Ast =
  | { type: 'num'; value: number }
  | { type: 'str'; value: string }
  | { type: 'bool'; value: boolean }
  | { type: 'err'; code: ErrCode }
  | { type: 'cell'; row: number; col: number; rowAbs: boolean; colAbs: boolean; sheet?: string }
  | { type: 'range'; start: Corner; end: Corner; sheet?: string }
  | { type: 'unary'; op: '-' | '+'; expr: Ast }
  | { type: 'percent'; expr: Ast }
  | { type: 'binary'; op: BinOp; left: Ast; right: Ast }
  | { type: 'call'; name: string; args: Ast[] };

export class ParseError extends Error {
  constructor(public code: ErrCode = '#ERR') {
    super(code);
  }
}

// -----------------------------------------------------------------------------
// Column <-> label
// -----------------------------------------------------------------------------

export function colToLabel(c: number): string {
  let s = '';
  let n = c;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
}

export function labelToCol(label: string): number {
  let c = 0;
  for (const ch of label.toUpperCase()) c = c * 26 + (ch.charCodeAt(0) - 64);
  return c - 1;
}

// -----------------------------------------------------------------------------
// Tokenizer
// -----------------------------------------------------------------------------

type TokenKind =
  | 'NUM' | 'STR' | 'IDENT' | 'CELL' | 'QNAME' | 'ERRLIT'
  | 'LPAREN' | 'RPAREN' | 'COMMA' | 'COLON' | 'BANG'
  | 'PLUS' | 'MINUS' | 'STAR' | 'SLASH' | 'CARET' | 'AMP' | 'PERCENT'
  | 'EQ' | 'NEQ' | 'LT' | 'GT' | 'LTE' | 'GTE';

interface Token { kind: TokenKind; text: string }

const CELL_RE = /^\$?[A-Za-z]+\$?\d+/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_.]*/;
// Number literal, incl. scientific notation (1e21, 1.5e-3, 1E+21) so that the
// serializer's String(value) output — which uses exponent form for very large
// or small magnitudes — round-trips back through the tokenizer.
const NUM_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/;
const ERR_RE = /^#[A-Za-z]+(?:\/[A-Za-z0-9]+)?[!?]?/;

// Map an error literal (as typed in a formula) to its ErrCode.
const ERR_LITERALS: Record<string, ErrCode> = {
  '#REF!': '#REF',
  '#DIV/0!': '#DIV/0',
  '#N/A': '#N/A',
  '#NAME?': '#NAME',
  '#VALUE!': '#VALUE',
  '#ERROR!': '#ERR',
  '#CIRCULAR!': '#CIRCULAR',
};

// Reverse map (ErrCode -> literal) for the serializer.
const ERR_CODE_TO_LITERAL: Record<ErrCode, string> = {
  '#REF': '#REF!',
  '#DIV/0': '#DIV/0!',
  '#N/A': '#N/A',
  '#NAME': '#NAME?',
  '#VALUE': '#VALUE!',
  '#ERR': '#ERROR!',
  '#CIRCULAR': '#CIRCULAR!',
};

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
    if (c === '(') { out.push({ kind: 'LPAREN', text: c }); i++; continue; }
    if (c === ')') { out.push({ kind: 'RPAREN', text: c }); i++; continue; }
    if (c === ',') { out.push({ kind: 'COMMA', text: c }); i++; continue; }
    if (c === ':') { out.push({ kind: 'COLON', text: c }); i++; continue; }
    if (c === '!') { out.push({ kind: 'BANG', text: c }); i++; continue; }
    if (c === '+') { out.push({ kind: 'PLUS', text: c }); i++; continue; }
    if (c === '-') { out.push({ kind: 'MINUS', text: c }); i++; continue; }
    if (c === '*') { out.push({ kind: 'STAR', text: c }); i++; continue; }
    if (c === '/') { out.push({ kind: 'SLASH', text: c }); i++; continue; }
    if (c === '^') { out.push({ kind: 'CARET', text: c }); i++; continue; }
    if (c === '&') { out.push({ kind: 'AMP', text: c }); i++; continue; }
    if (c === '%') { out.push({ kind: 'PERCENT', text: c }); i++; continue; }
    if (c === '=') { out.push({ kind: 'EQ', text: c }); i++; continue; }
    if (c === '<') {
      if (src[i + 1] === '=') { out.push({ kind: 'LTE', text: '<=' }); i += 2; continue; }
      if (src[i + 1] === '>') { out.push({ kind: 'NEQ', text: '<>' }); i += 2; continue; }
      out.push({ kind: 'LT', text: c }); i++; continue;
    }
    if (c === '>') {
      if (src[i + 1] === '=') { out.push({ kind: 'GTE', text: '>=' }); i += 2; continue; }
      out.push({ kind: 'GT', text: c }); i++; continue;
    }
    // Double-quoted string with "" escaping. Unterminated => error.
    if (c === '"') {
      let j = i + 1;
      let val = '';
      let closed = false;
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') { val += '"'; j += 2; continue; }
          closed = true;
          j++;
          break;
        }
        val += src[j];
        j++;
      }
      if (!closed) throw new ParseError('#ERR');
      out.push({ kind: 'STR', text: val });
      i = j;
      continue;
    }
    // Single-quoted sheet name with '' escaping.
    if (c === "'") {
      let j = i + 1;
      let val = '';
      let closed = false;
      while (j < src.length) {
        if (src[j] === "'") {
          if (src[j + 1] === "'") { val += "'"; j += 2; continue; }
          closed = true;
          j++;
          break;
        }
        val += src[j];
        j++;
      }
      if (!closed) throw new ParseError('#ERR');
      out.push({ kind: 'QNAME', text: val });
      i = j;
      continue;
    }
    // Error literal (#REF!, #DIV/0!, #N/A, ...).
    if (c === '#') {
      const rest = src.slice(i);
      const m = ERR_RE.exec(rest);
      if (!m) throw new ParseError('#ERR');
      out.push({ kind: 'ERRLIT', text: m[0] });
      i += m[0].length;
      continue;
    }
    // Number (must be tried before CELL so a leading-dot number wins).
    if (c === '.' || (c >= '0' && c <= '9')) {
      const m = NUM_RE.exec(src.slice(i));
      if (m) { out.push({ kind: 'NUM', text: m[0] }); i += m[0].length; continue; }
    }
    // Cell ref ($A$1) or identifier.
    if (c === '$' || /[A-Za-z_]/.test(c)) {
      const rest = src.slice(i);
      const cm = CELL_RE.exec(rest);
      // A cell ref only wins if it isn't immediately followed by more ident
      // characters (e.g. "A1B2" should not be CELL "A1" + ...). We still allow
      // it if the next char terminates the token.
      if (cm && !/[A-Za-z_]/.test(rest[cm[0].length] ?? '')) {
        out.push({ kind: 'CELL', text: cm[0] });
        i += cm[0].length;
        continue;
      }
      const im = IDENT_RE.exec(rest);
      if (im) { out.push({ kind: 'IDENT', text: im[0] }); i += im[0].length; continue; }
      throw new ParseError('#ERR');
    }
    throw new ParseError('#ERR');
  }
  return out;
}

// -----------------------------------------------------------------------------
// Parser
// -----------------------------------------------------------------------------

const COMPARE_OPS: Partial<Record<TokenKind, BinOp>> = {
  EQ: '=', NEQ: '<>', LT: '<', GT: '>', LTE: '<=', GTE: '>=',
};

class Parser {
  private pos = 0;
  constructor(private toks: Token[]) {}

  atEnd(): boolean { return this.pos >= this.toks.length; }
  private peek(o = 0): Token | undefined { return this.toks[this.pos + o]; }
  private next(): Token { const t = this.toks[this.pos]; if (!t) throw new ParseError('#ERR'); this.pos++; return t; }
  private eat(kind: TokenKind): Token {
    const t = this.toks[this.pos];
    if (!t || t.kind !== kind) throw new ParseError('#ERR');
    this.pos++;
    return t;
  }
  private match(kind: TokenKind): boolean {
    const t = this.toks[this.pos];
    if (t && t.kind === kind) { this.pos++; return true; }
    return false;
  }

  parseExpr(): Ast { return this.parseCompare(); }

  // Lowest precedence: comparisons (left-assoc). Chaining left-to-right is
  // intentional (see engine semantics note) — =1<2<3 evaluates (1<2)<3.
  private parseCompare(): Ast {
    let left = this.parseConcat();
    for (;;) {
      const t = this.peek();
      const op = t && COMPARE_OPS[t.kind];
      if (!op) break;
      this.pos++;
      left = { type: 'binary', op, left, right: this.parseConcat() };
    }
    return left;
  }

  private parseConcat(): Ast {
    let left = this.parseAddSub();
    while (this.match('AMP')) {
      left = { type: 'binary', op: '&', left, right: this.parseAddSub() };
    }
    return left;
  }

  private parseAddSub(): Ast {
    let left = this.parseMulDiv();
    for (;;) {
      if (this.match('PLUS')) left = { type: 'binary', op: '+', left, right: this.parseMulDiv() };
      else if (this.match('MINUS')) left = { type: 'binary', op: '-', left, right: this.parseMulDiv() };
      else break;
    }
    return left;
  }

  private parseMulDiv(): Ast {
    let left = this.parseUnary();
    for (;;) {
      if (this.match('STAR')) left = { type: 'binary', op: '*', left, right: this.parseUnary() };
      else if (this.match('SLASH')) left = { type: 'binary', op: '/', left, right: this.parseUnary() };
      else break;
    }
    return left;
  }

  // Unary minus binds looser than power (Google Sheets): -2^2 = -(2^2) = -4.
  private parseUnary(): Ast {
    if (this.match('MINUS')) return { type: 'unary', op: '-', expr: this.parseUnary() };
    if (this.match('PLUS')) return { type: 'unary', op: '+', expr: this.parseUnary() };
    return this.parsePower();
  }

  // Power is right-associative (2^3^2 = 2^(3^2)) and its exponent may itself be
  // a unary expression (2^-2 = 0.25).
  private parsePower(): Ast {
    const base = this.parsePostfix();
    if (this.match('CARET')) {
      return { type: 'binary', op: '^', left: base, right: this.parseUnary() };
    }
    return base;
  }

  // Postfix percent: 50% => 0.5, A1% etc.
  private parsePostfix(): Ast {
    let e = this.parsePrimary();
    while (this.match('PERCENT')) e = { type: 'percent', expr: e };
    return e;
  }

  private parsePrimary(): Ast {
    const t = this.peek();
    if (!t) throw new ParseError('#ERR');

    if (t.kind === 'NUM') { this.pos++; return { type: 'num', value: parseFloat(t.text) }; }
    if (t.kind === 'STR') { this.pos++; return { type: 'str', value: t.text }; }
    if (t.kind === 'ERRLIT') { this.pos++; return { type: 'err', code: ERR_LITERALS[t.text] ?? '#ERR' }; }
    if (t.kind === 'LPAREN') {
      this.pos++;
      const e = this.parseExpr();
      this.eat('RPAREN');
      return e;
    }

    // Sheet-qualified reference: NAME! <cellref/range>. NAME is a QNAME
    // ('Q3 Budget'), an IDENT (Sheet), or even a CELL-shaped token (Sheet2).
    if ((t.kind === 'QNAME' || t.kind === 'IDENT' || t.kind === 'CELL') && this.peek(1)?.kind === 'BANG') {
      const nameTok = this.next();
      this.eat('BANG');
      return this.parseRefAfterSheet(nameTok.text);
    }

    if (t.kind === 'CELL') { this.pos++; return this.finishRef(t.text, undefined); }

    if (t.kind === 'IDENT') {
      this.pos++;
      const upper = t.text.toUpperCase();
      // Function call.
      if (this.peek()?.kind === 'LPAREN') {
        this.eat('LPAREN');
        const args: Ast[] = [];
        if (!this.match('RPAREN')) {
          args.push(this.parseExpr());
          while (this.match('COMMA')) args.push(this.parseExpr());
          this.eat('RPAREN');
        }
        return { type: 'call', name: upper, args };
      }
      // Boolean literals.
      if (upper === 'TRUE') return { type: 'bool', value: true };
      if (upper === 'FALSE') return { type: 'bool', value: false };
      // A bare identifier is an error (matches legacy `=FOO` => #ERR).
      throw new ParseError('#ERR');
    }

    throw new ParseError('#ERR');
  }

  private parseRefAfterSheet(sheet: string): Ast {
    const t = this.eat('CELL');
    return this.finishRef(t.text, sheet);
  }

  // After consuming the first CELL token, optionally consume `:CELL` for a
  // range and attach the sheet.
  private finishRef(text: string, sheet: string | undefined): Ast {
    const a = parseCorner(text);
    if (this.match('COLON')) {
      const t2 = this.eat('CELL');
      const b = parseCorner(t2.text);
      return { type: 'range', start: a, end: b, sheet };
    }
    return { type: 'cell', row: a.row, col: a.col, rowAbs: a.rowAbs, colAbs: a.colAbs, sheet };
  }
}

function parseCorner(text: string): Corner {
  const m = text.match(/^(\$?)([A-Za-z]+)(\$?)(\d+)$/);
  if (!m) throw new ParseError('#REF');
  const colAbs = m[1] === '$';
  const col = labelToCol(m[2]);
  const rowAbs = m[3] === '$';
  const row = parseInt(m[4], 10) - 1;
  if (row < 0 || col < 0) throw new ParseError('#REF');
  return { row, col, rowAbs, colAbs };
}

// Parse a formula body (without a leading '='). Throws ParseError on trailing
// tokens or malformed input.
export function parse(src: string): Ast {
  const body = src.startsWith('=') ? src.slice(1) : src;
  const p = new Parser(tokenize(body));
  const ast = p.parseExpr();
  if (!p.atEnd()) throw new ParseError('#ERR');
  return ast;
}

// -----------------------------------------------------------------------------
// Serializer
// -----------------------------------------------------------------------------

function needsSheetQuote(name: string): boolean {
  return !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function sheetPrefix(sheet: string | undefined): string {
  if (sheet === undefined) return '';
  if (needsSheetQuote(sheet)) return `'${sheet.replace(/'/g, "''")}'!`;
  return `${sheet}!`;
}

function cornerStr(c: Corner): string {
  return `${c.colAbs ? '$' : ''}${colToLabel(c.col)}${c.rowAbs ? '$' : ''}${c.row + 1}`;
}

// Wrap compound operands in parens so the serialized form re-parses to the same
// tree. Over-parenthesizes (safe) rather than tracking precedence precisely.
function atom(node: Ast): string {
  if (node.type === 'binary' || node.type === 'unary' || node.type === 'percent') {
    return `(${serialize(node)})`;
  }
  return serialize(node);
}

export function serialize(node: Ast): string {
  switch (node.type) {
    case 'num': return String(node.value);
    case 'str': return `"${node.value.replace(/"/g, '""')}"`;
    case 'bool': return node.value ? 'TRUE' : 'FALSE';
    case 'err': return ERR_CODE_TO_LITERAL[node.code];
    case 'cell':
      return sheetPrefix(node.sheet) + cornerStr({ row: node.row, col: node.col, rowAbs: node.rowAbs, colAbs: node.colAbs });
    case 'range':
      return sheetPrefix(node.sheet) + cornerStr(node.start) + ':' + cornerStr(node.end);
    case 'unary': return node.op + atom(node.expr);
    case 'percent': return atom(node.expr) + '%';
    case 'binary': return `${atom(node.left)}${node.op}${atom(node.right)}`;
    case 'call': return `${node.name}(${node.args.map(serialize).join(',')})`;
  }
}

// Convenience: serialize as a stored formula (with leading '=').
export function serializeFormula(node: Ast): string {
  return '=' + serialize(node);
}
