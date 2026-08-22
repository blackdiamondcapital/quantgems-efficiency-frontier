import test from 'node:test';
import assert from 'node:assert/strict';
import { invertMatrix, buildFrontier } from './meanVariance.js';

test('2x2 inverse', () => {
  const inv = invertMatrix([[4, 1], [1, 3]]);
  assert.ok(inv);
  assert.ok(Math.abs(inv[0][0] * 4 + inv[0][1] * 1 - 1) < 1e-6);
});

test('two-asset frontier has GMV and tangency', () => {
  const t = 80;
  const a = Array.from({ length: t }, (_, i) => 0.001 + 0.01 * Math.sin(i / 7));
  const b = Array.from({ length: t }, (_, i) => 0.0004 + 0.02 * Math.cos(i / 5));
  const out = buildFrontier({
    symbols: ['A', 'B'],
    matrix: [a, b],
    rfAnnual: 0.01,
    longOnly: true,
    points: 10,
  });
  assert.equal(out.assets.length, 2);
  assert.ok(out.gmv.vol > 0);
  assert.ok(out.tangency.sharpe >= out.gmv.sharpe - 1e-6);
  assert.equal(out.frontier.length, 10);
});
