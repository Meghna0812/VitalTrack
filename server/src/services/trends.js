// Trend analysis: is a biomarker drifting toward an abnormal value?
//
// A value can be "normal" today and still be worrying: fasting glucose
// 85 -> 92 -> 98 is normal every time, but heading toward the 99 limit.
// We fit a straight line through the points (linear regression), look at its
// slope and project 90 days ahead.

const DAY_MS = 24 * 60 * 60 * 1000;
export const PROJECTION_DAYS = 90;
const NEAR_EDGE = 0.1;   // within 10% of the range width from a limit counts as "near"
const STABLE = 0.02;     // less than 2% of range width change over 90 days = stable

/** Least-squares slope of y over x. */
function slope(xs, ys) {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

/**
 * @param {{date: string, value: number}[]} points  chronological, canonical units
 * @param {[number|null, number|null]} range         reference range [low, high]
 */
export function analyzeSeries(points, [low, high]) {
  const latest = points.at(-1).value;
  const status = low != null && latest < low ? 'low' : high != null && latest > high ? 'high' : 'normal';

  if (points.length < 2) {
    return { status, direction: 'insufficient_data', slopePerDay: null, projected: null,
      flag: status === 'normal' ? 'none' : 'abnormal' };
  }

  const t0 = new Date(points[0].date).getTime();
  const xs = points.map((p) => (new Date(p.date).getTime() - t0) / DAY_MS);
  const ys = points.map((p) => p.value);
  const perDay = slope(xs, ys);
  const projected = latest + perDay * PROJECTION_DAYS;

  // How wide is "normal"? With a one-sided range (e.g. LDL < 100) use the limit itself.
  const width = low != null && high != null ? high - low : Math.abs(high ?? low ?? latest) || 1;
  const change = perDay * PROJECTION_DAYS;
  const direction = Math.abs(change) < STABLE * width ? 'stable' : change > 0 ? 'rising' : 'falling';

  let flag = 'none';
  if (status !== 'normal') flag = 'abnormal';
  else if (direction === 'rising' && high != null && (projected > high || high - latest < NEAR_EDGE * width)) flag = 'approaching_high';
  else if (direction === 'falling' && low != null && (projected < low || latest - low < NEAR_EDGE * width)) flag = 'approaching_low';

  return { status, direction, slopePerDay: perDay, projected: Math.round(projected * 100) / 100, flag };
}
