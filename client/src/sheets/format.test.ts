// Tests for cell style parsing/encoding and display formatting.
//
// applyFormat uses toLocaleString/toLocaleDateString with the system locale,
// so the exact-string assertions below assume an en-US locale (the dev
// machine). Date assertions marked TZ-dependent assume a timezone west of
// UTC (America/Phoenix at time of writing).

import { describe, expect, test } from 'bun:test';
import { applyFormat, encodeStyle, mergeStyle, parseStyle, type CellStyle } from './format';

describe('parseStyle', () => {
  test('undefined yields empty style', () => {
    expect(parseStyle(undefined)).toEqual({});
  });

  test('empty string yields empty style', () => {
    expect(parseStyle('')).toEqual({});
  });

  test('parses a JSON style object', () => {
    const s: CellStyle = {
      b: 1, i: 1, u: 1,
      bg: '#ff0000', fg: '#00ff00',
      fmt: 'currency', decimals: 2, align: 'r',
    };
    expect(parseStyle(JSON.stringify(s))).toEqual(s);
  });

  test('legacy "b" sets bold', () => {
    expect(parseStyle('b')).toEqual({ b: 1 });
  });

  test('legacy "i" sets italic', () => {
    expect(parseStyle('i')).toEqual({ i: 1 });
  });

  test('legacy "bi" sets both', () => {
    expect(parseStyle('bi')).toEqual({ b: 1, i: 1 });
  });

  // NOTE: arguably buggy — the legacy fallback only understands 'b' and 'i'
  // (format.ts:26-31), so a legacy underline flag is silently dropped.
  test('legacy "u" is not understood and yields empty style', () => {
    expect(parseStyle('u')).toEqual({});
  });

  test('legacy parsing is substring-based ("big" sets b and i)', () => {
    expect(parseStyle('big')).toEqual({ b: 1, i: 1 });
  });

  test('valid JSON that is not an object yields empty style', () => {
    expect(parseStyle('123')).toEqual({});
    expect(parseStyle('null')).toEqual({});
    // '"b"' parses as a JSON string, so the legacy path is NOT taken.
    expect(parseStyle('"b"')).toEqual({});
  });
});

describe('encodeStyle', () => {
  test('empty style encodes as {}', () => {
    expect(encodeStyle({})).toBe('{}');
  });

  test('preserves key insertion order', () => {
    expect(encodeStyle({ b: 1, fg: 'red' })).toBe('{"b":1,"fg":"red"}');
  });

  test('drops undefined fields', () => {
    expect(encodeStyle({ b: 1, bg: undefined })).toBe('{"b":1}');
  });

  test('drops empty-string fields', () => {
    expect(encodeStyle({ bg: '', fg: '#fff' })).toBe('{"fg":"#fff"}');
  });

  test('drops NaN numeric fields', () => {
    expect(encodeStyle({ decimals: Number.NaN, b: 1 })).toBe('{"b":1}');
  });

  test('keeps decimals: 0 (zero is not "empty")', () => {
    expect(encodeStyle({ decimals: 0 })).toBe('{"decimals":0}');
  });

  test('round-trips through parseStyle with empty fields stripped', () => {
    const s: CellStyle = { b: 1, bg: '', fmt: 'percent', decimals: 1 };
    expect(parseStyle(encodeStyle(s))).toEqual({ b: 1, fmt: 'percent', decimals: 1 });
  });
});

describe('mergeStyle', () => {
  test('b wins on conflicts', () => {
    expect(mergeStyle({ fg: 'red', b: 1 }, { fg: 'blue' })).toEqual({ fg: 'blue', b: 1 });
  });

  test('non-overlapping fields are combined', () => {
    expect(mergeStyle({ b: 1 }, { i: 1, align: 'c' })).toEqual({ b: 1, i: 1, align: 'c' });
  });

  test('merging with empty style is a copy', () => {
    expect(mergeStyle({ b: 1, fmt: 'date' }, {})).toEqual({ b: 1, fmt: 'date' });
  });
});

describe('applyFormat', () => {
  test('empty value passes through regardless of format', () => {
    expect(applyFormat('', { fmt: 'currency' })).toBe('');
  });

  test('auto and plain pass values through untouched', () => {
    expect(applyFormat('1234.5', {})).toBe('1234.5');
    expect(applyFormat('1234.5', { fmt: 'auto' })).toBe('1234.5');
    expect(applyFormat('1234.5', { fmt: 'plain' })).toBe('1234.5');
  });

  describe('number', () => {
    test('adds thousands separators (up to 6 fraction digits by default)', () => {
      expect(applyFormat('1234.5', { fmt: 'number' })).toBe('1,234.5');
      expect(applyFormat('3.14159265', { fmt: 'number' })).toBe('3.141593');
    });

    test('fixed decimals pad and round', () => {
      expect(applyFormat('1234.5', { fmt: 'number', decimals: 2 })).toBe('1,234.50');
      expect(applyFormat('1234.5', { fmt: 'number', decimals: 0 })).toBe('1,235');
    });

    test('non-numeric input passes through', () => {
      expect(applyFormat('abc', { fmt: 'number' })).toBe('abc');
    });
  });

  describe('currency', () => {
    test('defaults to 2 decimals USD', () => {
      expect(applyFormat('1234.5', { fmt: 'currency' })).toBe('$1,234.50');
    });

    test('respects explicit decimals', () => {
      expect(applyFormat('1234.5', { fmt: 'currency', decimals: 0 })).toBe('$1,235');
    });

    test('negative values', () => {
      expect(applyFormat('-3', { fmt: 'currency' })).toBe('-$3.00');
    });

    test('non-numeric input passes through', () => {
      expect(applyFormat('n/a', { fmt: 'currency' })).toBe('n/a');
    });

    // --- currency field (new) ---

    test('back-compat: a style with no currency renders USD', () => {
      // Simulates an old encoded style (no `currency` key) round-tripped in.
      const legacy = parseStyle(JSON.stringify({ fmt: 'currency' }));
      expect(legacy.currency).toBeUndefined();
      expect(applyFormat('1234.5', legacy)).toBe('$1,234.50');
    });

    test('explicit currency codes', () => {
      expect(applyFormat('1234.5', { fmt: 'currency', currency: 'EUR' })).toBe('€1,234.50');
      expect(applyFormat('1234.5', { fmt: 'currency', currency: 'GBP' })).toBe('£1,234.50');
      // JPY has no minor unit, so unset decimals => 0 fraction digits.
      expect(applyFormat('1234.5', { fmt: 'currency', currency: 'JPY' })).toBe('¥1,235');
      expect(applyFormat('1234.5', { fmt: 'currency', currency: 'CAD' })).toBe('CA$1,234.50');
    });

    test('currency respects explicit decimals over the code default', () => {
      expect(applyFormat('1234.5', { fmt: 'currency', currency: 'JPY', decimals: 2 })).toBe('¥1,234.50');
      expect(applyFormat('1234.5', { fmt: 'currency', currency: 'EUR', decimals: 0 })).toBe('€1,235');
    });

    test('a currency symbol is mapped to its ISO code', () => {
      expect(applyFormat('10', { fmt: 'currency', currency: '$' })).toBe('$10.00');
      expect(applyFormat('10', { fmt: 'currency', currency: '€' })).toBe('€10.00');
    });

    test('a malformed currency code falls back to USD', () => {
      expect(applyFormat('10', { fmt: 'currency', currency: 'US' })).toBe('$10.00');
    });

    test('currency round-trips through encode/parse', () => {
      const s: CellStyle = { fmt: 'currency', currency: 'EUR', decimals: 2 };
      expect(parseStyle(encodeStyle(s))).toEqual(s);
    });
  });

  describe('percent', () => {
    test('multiplies by 100 with 1 decimal by default', () => {
      expect(applyFormat('0.5', { fmt: 'percent' })).toBe('50.0%');
      expect(applyFormat('0.1234', { fmt: 'percent' })).toBe('12.3%');
    });

    test('respects explicit decimals', () => {
      expect(applyFormat('0.5', { fmt: 'percent', decimals: 2 })).toBe('50.00%');
      expect(applyFormat('0.5', { fmt: 'percent', decimals: 0 })).toBe('50%');
    });

    test('non-numeric input passes through', () => {
      expect(applyFormat('half', { fmt: 'percent' })).toBe('half');
    });
  });

  describe('date', () => {
    test('formats a slash date (parsed as local midnight)', () => {
      expect(applyFormat('01/15/2024', { fmt: 'date' })).toBe('Jan 15, 2024');
    });

    test('treats large all-digit values as epoch milliseconds', () => {
      // 2024-01-15T12:00:00Z — noon UTC so the local calendar date matches
      // in any timezone within UTC±11.
      expect(applyFormat('1705320000000', { fmt: 'date' })).toBe('Jan 15, 2024');
    });

    // NOTE: arguably buggy — bare ISO dates are parsed by Date.parse as UTC
    // midnight but rendered with toLocaleDateString in the local timezone
    // (format.ts:88-98), so in the running app the displayed day shifts back
    // by one anywhere west of UTC (e.g. 'Jan 14, 2024' in America/Phoenix).
    // bun test forces TZ to UTC, so this assertion sees the unshifted date.
    test('ISO date input is parsed as UTC midnight (shifts a day west of UTC)', () => {
      expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe('UTC');
      expect(applyFormat('2024-01-15', { fmt: 'date' })).toBe('Jan 15, 2024');
    });

    test('unparseable input passes through', () => {
      expect(applyFormat('not a date', { fmt: 'date' })).toBe('not a date');
    });

    // --- dateFmt field (new); bun forces TZ=UTC so ISO input is unshifted ---

    test('back-compat: no dateFmt keeps the legacy medium form', () => {
      const legacy = parseStyle(JSON.stringify({ fmt: 'date' }));
      expect(legacy.dateFmt).toBeUndefined();
      expect(applyFormat('2024-01-15', legacy)).toBe('Jan 15, 2024');
    });

    test('explicit patterns', () => {
      expect(applyFormat('2024-01-15', { fmt: 'date', dateFmt: 'yyyy-mm-dd' })).toBe('2024-01-15');
      expect(applyFormat('2024-01-15', { fmt: 'date', dateFmt: 'mm/dd/yyyy' })).toBe('01/15/2024');
      expect(applyFormat('2024-01-15', { fmt: 'date', dateFmt: 'm/d/yyyy' })).toBe('1/15/2024');
      expect(applyFormat('2024-01-15', { fmt: 'date', dateFmt: 'mmm d, yyyy' })).toBe('Jan 15, 2024');
    });

    test('single-digit month/day zero-pad only for the padded patterns', () => {
      expect(applyFormat('2024-03-05', { fmt: 'date', dateFmt: 'mm/dd/yyyy' })).toBe('03/05/2024');
      expect(applyFormat('2024-03-05', { fmt: 'date', dateFmt: 'm/d/yyyy' })).toBe('3/5/2024');
      expect(applyFormat('2024-03-05', { fmt: 'date', dateFmt: 'yyyy-mm-dd' })).toBe('2024-03-05');
    });

    test('patterns also apply to epoch-ms input', () => {
      // 2024-01-15T12:00:00Z (noon UTC).
      expect(applyFormat('1705320000000', { fmt: 'date', dateFmt: 'yyyy-mm-dd' })).toBe('2024-01-15');
    });

    test('dateFmt round-trips through encode/parse', () => {
      const s: CellStyle = { fmt: 'date', dateFmt: 'mm/dd/yyyy' };
      expect(parseStyle(encodeStyle(s))).toEqual(s);
    });
  });
});
