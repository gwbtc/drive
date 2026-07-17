// Minimal CSV parser + serializer. Handles quoted fields with embedded
// commas, newlines, and `""` to escape a quote. No streaming — sheets are
// already bounded by 50×16 in the UI, so the whole file fits in memory.

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cur += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(cur);
      cur = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      // Skip CR; LF handles row terminator below.
      i++;
      continue;
    }
    if (ch === '\n') {
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  if (cur !== '' || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows;
}

const needsQuoting = (s: string) => /[",\r\n]/.test(s);

export function cellsToCSV(
  cells: Record<string, string>,
  rows: number,
  cols: number,
): string {
  const out: string[] = [];
  // Find the bounding box of non-empty cells; export at least that.
  let maxR = -1;
  let maxC = -1;
  for (const k of Object.keys(cells)) {
    const [r, c] = k.split(':').map(Number);
    if (r > maxR) maxR = r;
    if (c > maxC) maxC = c;
  }
  const lastR = Math.min(rows - 1, Math.max(maxR, 0));
  const lastC = Math.min(cols - 1, Math.max(maxC, 0));
  for (let r = 0; r <= lastR; r++) {
    const line: string[] = [];
    for (let c = 0; c <= lastC; c++) {
      const v = cells[`${r}:${c}`] ?? '';
      line.push(needsQuoting(v) ? `"${v.replace(/"/g, '""')}"` : v);
    }
    out.push(line.join(','));
  }
  return out.join('\n');
}
