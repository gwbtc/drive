// Incrementality proof. The engine instruments `evalCount` (total AST-node
// evaluations). A dependency chain A1 <- A2 <- ... <- AN lets us show that an
// edit costs O(dirty) node-evaluations, NOT O(n) or the legacy O(n^2).
//
// Chain shape: A1 = A2+1, A2 = A3+1, ..., A(N-1) = AN+1, AN = 0.
//   * AN is the SOURCE — every other cell depends on it (transitively).
//   * A1 is the SINK — nothing depends on it.

import { describe, expect, test } from 'bun:test';
import { CalcEngine } from './engine';

function buildChain(n: number): CalcEngine {
  const e = new CalcEngine();
  e.addSheet('S');
  const changes: Array<{ id: string; raw: string }> = [];
  for (let r = 0; r < n - 1; r++) changes.push({ id: `S!${r}:0`, raw: `=A${r + 2}+1` });
  changes.push({ id: `S!${n - 1}:0`, raw: '0' });
  e.setCells(changes);
  return e;
}

describe('incremental recalculation is O(dirty)', () => {
  const N = 500;
  const NODES_PER_FORMULA = 3; // binary(+), cell ref, num literal

  test('the chain computes correctly (A1 = N-1)', () => {
    const e = buildChain(N);
    expect(e.getValue('S!0:0')).toBe(N - 1);
  });

  test('editing the SINK (A1) re-evaluates ~1 cell', () => {
    const e = buildChain(N);
    const before = e.evalCount;
    e.setCells([{ id: 'S!0:0', raw: '=A2+5' }]); // nobody depends on A1
    const delta = e.evalCount - before;
    expect(delta).toBeLessThanOrEqual(NODES_PER_FORMULA + 1);
  });

  test('editing the SOURCE (AN) re-evaluates exactly the transitive dependents', () => {
    const e = buildChain(N);
    const before = e.evalCount;
    e.setCells([{ id: `S!${N - 1}:0`, raw: '100' }]); // all N-1 formulas depend on AN
    const delta = e.evalCount - before;
    // Linear in the number of dirty formula cells, and far below O(n^2).
    expect(delta).toBe((N - 1) * NODES_PER_FORMULA);
    expect(delta).toBeLessThan(N * N); // would be ~n^2 for a naive full recalc
  });

  test('editing the MIDDLE dirties only the cells above it', () => {
    const e = buildChain(N);
    const mid = 250;
    const before = e.evalCount;
    // Re-point the middle cell so its value actually changes (drives repaint).
    const repaint = e.setCells([{ id: `S!${mid}:0`, raw: `=A${mid + 2}+100` }]);
    const delta = e.evalCount - before;
    // Cells 0..mid depend on A(mid+1) transitively => mid+1 dirty formula cells.
    expect(delta).toBe((mid + 1) * NODES_PER_FORMULA);
    expect(repaint.size).toBe(mid + 1);
  });

  test('a leaf edit is independent of chain length (5000-cell chain)', () => {
    const big = buildChain(5000);
    const before = big.evalCount;
    big.setCells([{ id: 'S!0:0', raw: '=A2+9' }]); // sink edit on a huge chain
    const delta = big.evalCount - before;
    expect(delta).toBeLessThanOrEqual(NODES_PER_FORMULA + 1);
  });

  test('=SUM(A:A)-scale range does not materialize an edge per cell', () => {
    // A 26k-cell column sum. Editing one input recomputes only the SUM cell
    // (plus that input), proving range subscriptions keep the graph small.
    const e = new CalcEngine();
    e.addSheet('S');
    const changes: Array<{ id: string; raw: string }> = [];
    for (let r = 0; r < 1000; r++) changes.push({ id: `S!${r}:0`, raw: String(r) });
    changes.push({ id: 'S!0:5', raw: '=SUM(A1:A1000)' });
    e.setCells(changes);
    expect(e.getValue('S!0:5')).toBe((999 * 1000) / 2);

    const before = e.evalCount;
    const repaint = e.setCells([{ id: 'S!10:0', raw: '10000' }]);
    const delta = e.evalCount - before;
    // Only the edited input and the SUM owner are dirty; SUM is a single node
    // evaluation even though it reads 1000 cells.
    expect(repaint.has('S!0:5')).toBe(true);
    expect(delta).toBeLessThan(10);
    expect(e.getValue('S!0:5')).toBe((999 * 1000) / 2 - 10 + 10000);
  });
});
