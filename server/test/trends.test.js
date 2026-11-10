import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSeries } from '../src/services/trends.js';

const series = (...pairs) => pairs.map(([date, value]) => ({ date, value }));

test('normal but rising toward the upper limit is flagged', () => {
  const r = analyzeSeries(series(['2026-01-12', 86], ['2026-05-18', 91.9], ['2026-09-21', 97]), [70, 100]);
  assert.equal(r.status, 'normal');
  assert.equal(r.direction, 'rising');
  assert.equal(r.flag, 'approaching_high');
});

test('flat series is stable and not flagged', () => {
  const r = analyzeSeries(series(['2026-01-01', 14], ['2026-04-01', 14.05], ['2026-07-01', 14]), [12, 17.5]);
  assert.equal(r.direction, 'stable');
  assert.equal(r.flag, 'none');
});

test('falling toward the lower limit is flagged', () => {
  const r = analyzeSeries(series(['2026-01-01', 45], ['2026-06-01', 42]), [40, null]); // HDL
  assert.equal(r.flag, 'approaching_low');
});

test('out of range is abnormal regardless of trend', () => {
  assert.equal(analyzeSeries(series(['2026-01-01', 120]), [70, 99]).flag, 'abnormal');
});

test('rising away from a lower-only limit is fine', () => {
  const r = analyzeSeries(series(['2026-01-01', 45], ['2026-06-01', 55]), [40, null]);
  assert.equal(r.flag, 'none');
});
