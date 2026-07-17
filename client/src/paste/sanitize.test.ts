// Tests for the pure pasted-HTML sanitizer, using real-world Word / Google
// Docs / web-page clipboard fragments.

import { describe, expect, test } from 'bun:test';
import { sanitizePastedHtml } from './sanitize';

describe('basics', () => {
  test('empty input', () => {
    expect(sanitizePastedHtml('')).toBe('');
  });

  test('plain paragraph survives', () => {
    expect(sanitizePastedHtml('<p>hello</p>')).toBe('<p>hello</p>');
  });

  test('semantic marks survive', () => {
    const out = sanitizePastedHtml('<p><b>bold</b> <i>it</i> <u>u</u> <s>s</s></p>');
    expect(out).toContain('<b>bold</b>');
    expect(out).toContain('<i>it</i>');
    expect(out).toContain('<u>u</u>');
    expect(out).toContain('<s>s</s>');
  });

  test('div is renamed to p so block breaks survive', () => {
    expect(sanitizePastedHtml('<div>a</div><div>b</div>')).toBe('<p>a</p><p>b</p>');
  });
});

describe('junk stripping', () => {
  test('class / id / lang / dir attributes are removed', () => {
    const out = sanitizePastedHtml(
      '<p class="MsoNormal" id="x" lang="EN-US" dir="ltr">t</p>',
    );
    expect(out).toBe('<p>t</p>');
    expect(out).not.toContain('class');
    expect(out).not.toContain('id=');
    expect(out).not.toContain('dir');
  });

  test('style blocks are removed with their contents', () => {
    const out = sanitizePastedHtml('<style>p{mso-x:1}</style><p>keep</p>');
    expect(out).toBe('<p>keep</p>');
    expect(out).not.toContain('mso');
  });

  test('script blocks are removed with their contents', () => {
    const out = sanitizePastedHtml('<p>ok<script>alert(1)</script></p>');
    expect(out).toBe('<p>ok</p>');
    expect(out).not.toContain('alert');
  });

  test('javascript: hrefs are dropped', () => {
    const out = sanitizePastedHtml('<a href="javascript:evil()">x</a>');
    expect(out).toBe('<a>x</a>');
  });

  test('http hrefs are preserved', () => {
    expect(sanitizePastedHtml('<a href="https://e.co/p">x</a>')).toBe(
      '<a href="https://e.co/p">x</a>',
    );
  });

  test('attribute-less spans are unwrapped', () => {
    expect(sanitizePastedHtml('<span>x</span>')).toBe('x');
    expect(sanitizePastedHtml('<span class="foo">x</span>')).toBe('x');
    expect(sanitizePastedHtml('<span></span>')).toBe('');
  });

  test('unknown wrapper tags are unwrapped, keeping children', () => {
    expect(sanitizePastedHtml('<font face="Arial">x</font>')).toBe('x');
    expect(sanitizePastedHtml('<section><p>x</p></section>')).toBe('<p>x</p>');
  });
});

describe('style whitelist', () => {
  test('colour / font-family / font-size are dropped from spans (unwrapped)', () => {
    const out = sanitizePastedHtml(
      '<span style="color:#ff0000;font-family:Arial;font-size:14pt">x</span>',
    );
    expect(out).toBe('x');
  });

  test('font-weight / font-style / text-decoration are kept', () => {
    const out = sanitizePastedHtml(
      '<span style="color:red;font-weight:700;font-style:italic;text-decoration:underline">x</span>',
    );
    expect(out).toContain('font-weight:700');
    expect(out).toContain('font-style:italic');
    expect(out).toContain('text-decoration:underline');
    expect(out).not.toContain('color');
  });

  test('text-align survives on block tags', () => {
    expect(sanitizePastedHtml('<p style="margin:0;text-align:center">x</p>')).toBe(
      '<p style="text-align:center">x</p>',
    );
  });

  test('mso-* values are dropped even for whitelisted props', () => {
    const out = sanitizePastedHtml('<p style="text-align:mso-something">x</p>');
    expect(out).toBe('<p>x</p>');
  });
});

describe('Microsoft Word fixture', () => {
  const WORD = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
<head><meta charset=utf-8><style><!-- .MsoNormal{mso-style-parent:""} --></style></head>
<body lang=EN-US link=blue>
<!--[if gte mso 9]><xml><o:OfficeDocumentSettings/></xml><![endif]-->
<p class=MsoNormal style='margin:0in;mso-pagination:widow-orphan'><span style='font-size:11.0pt;font-family:"Calibri",sans-serif;color:black'>Hello <b>bold</b> and <i>italic</i>.<o:p></o:p></span></p>
<h1 style='mso-outline-level:1'><span style='color:#1F3864;font-family:"Calibri Light",sans-serif'>Title</span></h1>
</body></html>`;

  const out = sanitizePastedHtml(WORD);

  test('no Office noise remains', () => {
    expect(out).not.toContain('mso');
    expect(out).not.toContain('o:p');
    expect(out).not.toContain('class');
    expect(out).not.toContain('font-family');
    expect(out.toLowerCase()).not.toContain('xml');
    expect(out).not.toContain('color');
  });

  test('semantic content survives', () => {
    expect(out).toContain('<b>bold</b>');
    expect(out).toContain('<i>italic</i>');
    expect(out).toContain('Hello');
    expect(out).toContain('<h1>');
    expect(out).toContain('Title');
  });
});

describe('Google Docs fixture', () => {
  const GDOCS = `<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-abc"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial;color:#000000;font-weight:700;">Bold</span><span style="font-size:11pt;font-family:Arial;color:#000000;font-weight:400;font-style:italic;"> and italic</span></p><ul style="margin-top:0;padding:0;"><li dir="ltr" style="margin-left:36pt;"><span style="font-family:Arial;">Item one</span></li></ul></b>`;

  const out = sanitizePastedHtml(GDOCS);

  test('drops guid / dir / font-family / colour', () => {
    expect(out).not.toContain('docs-internal-guid');
    expect(out).not.toContain('dir=');
    expect(out).not.toContain('font-family');
    expect(out).not.toContain('color');
  });

  test('keeps the style-encoded bold/italic that Google Docs uses', () => {
    expect(out).toContain('font-weight:700');
    expect(out).toContain('font-style:italic');
  });

  test('keeps the wrapping <b> (with font-weight:normal so it is not bold)', () => {
    // tiptap Bold ignores a <b> whose font-weight is normal.
    expect(out).toContain('font-weight:normal');
  });

  test('keeps real list structure', () => {
    expect(out).toContain('<ul>');
    expect(out).toContain('<li>');
    expect(out).toContain('Item one');
  });
});

describe('tables', () => {
  test('table structure and colspan survive; style is stripped', () => {
    const out = sanitizePastedHtml(
      '<table border="1" width="500"><tr><th class="h" colspan="2">H</th></tr><tr><td style="background:red">c</td><td>d</td></tr></table>',
    );
    expect(out).toContain('<table>');
    expect(out).toContain('<th colspan="2">');
    expect(out).toContain('<td>c</td>');
    expect(out).not.toContain('background');
    expect(out).not.toContain('width');
  });
});

describe('attribute-name boundaries (bug 3)', () => {
  test('data-href does not shadow the real href', () => {
    expect(sanitizePastedHtml('<a data-href="evil" href="good">x</a>')).toBe(
      '<a href="good">x</a>',
    );
  });

  test('the wrong URL is never extracted regardless of attribute order', () => {
    expect(sanitizePastedHtml('<a href="good" data-href="evil">x</a>')).toBe(
      '<a href="good">x</a>',
    );
    expect(sanitizePastedHtml('<a xhref="evil" href="good">x</a>')).toBe(
      '<a href="good">x</a>',
    );
  });

  test('data-src does not shadow the real img src', () => {
    const out = sanitizePastedHtml('<img data-src="lazy.gif" src="https://e.co/i.png">');
    expect(out).toContain('src="https://e.co/i.png"');
    expect(out).not.toContain('lazy');
  });

  test('an attribute-less lookup yields no attribute', () => {
    // Only data-href present → there is no real href to extract.
    expect(sanitizePastedHtml('<a data-href="evil">x</a>')).toBe('<a>x</a>');
    expect(sanitizePastedHtml('<a>x</a>')).toBe('<a>x</a>');
  });

  test('real href / src / style extraction still works', () => {
    expect(sanitizePastedHtml('<a href="https://e.co/p">x</a>')).toBe(
      '<a href="https://e.co/p">x</a>',
    );
    expect(sanitizePastedHtml('<p style="text-align:center">x</p>')).toBe(
      '<p style="text-align:center">x</p>',
    );
  });
});

describe('XSS hardening', () => {
  test('javascript: href is dropped', () => {
    expect(sanitizePastedHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
  });

  test('vbscript: href is dropped', () => {
    expect(sanitizePastedHtml('<a href="vbscript:msgbox(1)">x</a>')).toBe('<a>x</a>');
  });

  test('data: href (script/markup payload) is dropped', () => {
    expect(
      sanitizePastedHtml('<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>'),
    ).toBe('<a>x</a>');
  });

  test('scheme obfuscated with embedded whitespace/newlines is still dropped', () => {
    expect(sanitizePastedHtml('<a href="java\tscript:alert(1)">x</a>')).toBe('<a>x</a>');
    expect(sanitizePastedHtml('<a href="  JAVASCRIPT:alert(1)">x</a>')).toBe('<a>x</a>');
  });

  test('on* event handlers never survive', () => {
    const out = sanitizePastedHtml('<p onclick="steal()" onmouseover="x()">hi</p>');
    expect(out).toBe('<p>hi</p>');
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('onmouseover');
  });

  test('img: javascript src dropped, data:image kept, data:text/html dropped', () => {
    expect(sanitizePastedHtml('<img src="javascript:alert(1)">')).toBe('<img>');
    expect(sanitizePastedHtml('<img src="data:image/png;base64,iVBORw0KGgo=">')).toContain(
      'src="data:image/png;base64,iVBORw0KGgo="',
    );
    expect(sanitizePastedHtml('<img src="data:text/html;base64,PHN2Zz4=">')).toBe('<img>');
  });
});
