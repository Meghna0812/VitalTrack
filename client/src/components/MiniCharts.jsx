// The small charts inside each trend card. Hand-written SVG: for charts this simple
// a charting library would add a lot of code for little benefit.
import { formatMonth, formatDate, formatValue } from '../format.js';

const W = 168, H = 64;      // drawing size (scaled by CSS)
const MAX_POINTS = 7;       // like the weekly cards in the design: show the last 7 results

/** Shared maths: the y-axis covers both the values and the reference range, with a little padding. */
function scale(points, [low, high]) {
  const values = points.map((p) => p.value);
  const lo = Math.min(...values, low ?? Infinity);
  const hi = Math.max(...values, high ?? -Infinity);
  const pad = (hi - lo || Math.abs(hi) || 1) * 0.15;
  const min = lo - pad, max = hi + pad;
  return (v) => H - ((v - min) / (max - min)) * H;
}

const outOfRange = (v, [low, high]) => (low != null && v < low) || (high != null && v > high);

function Labels({ points }) {
  return (
    <div className="chart-labels">
      {points.map((p, i) => <span key={i}>{formatMonth(p.date)}</span>)}
    </div>
  );
}

/** Line with a soft gradient underneath – used for e.g. glucose, kidney, liver. */
export function MiniLine({ points: all, range, color, id }) {
  const points = all.slice(-MAX_POINTS);
  const y = scale(points, range);
  const x = (i) => (points.length === 1 ? W / 2 : 6 + (i / (points.length - 1)) * (W - 12));
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  const area = `${line} L${x(points.length - 1)},${H} L${x(0)},${H} Z`;
  const [low, high] = range;

  return (
    <div className="mini-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="trend" overflow="visible">
        <defs>
          <linearGradient id={`g-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* dashed lines mark the edges of the normal range */}
        {high != null && <line x1="0" x2={W} y1={y(high)} y2={y(high)} className="limit" />}
        {low != null && <line x1="0" x2={W} y1={y(low)} y2={y(low)} className="limit" />}
        {points.length > 1 && <path d={area} fill={`url(#g-${id})`} />}
        {points.length > 1 && <path d={line} fill="none" stroke={color} strokeWidth="2.2" strokeLinejoin="round" />}
        {points.map((p, i) => (
          <circle key={i} cx={x(i)} cy={y(p.value)} r="3.2" fill={outOfRange(p.value, range) ? '#e5484d' : color}>
            <title>{`${formatDate(p.date)}: ${formatValue(p.value)}`}</title>
          </circle>
        ))}
      </svg>
      <Labels points={points} />
    </div>
  );
}

/** Rounded bars on a grey track – used for e.g. blood count, lipids, thyroid. */
export function MiniBars({ points: all, range, color }) {
  const points = all.slice(-MAX_POINTS);
  const y = scale(points, range);
  return (
    <div className="mini-chart">
      <div className="bars">
        {points.map((p, i) => {
          const pct = Math.max(8, Math.min(100, ((H - y(p.value)) / H) * 100));
          const bad = outOfRange(p.value, range);
          return (
            <div className="bar-track" key={i} title={`${formatDate(p.date)}: ${formatValue(p.value)}`}>
              <div className="bar-fill" style={{ height: `${pct}%`, background: bad ? '#e5484d' : color }} />
            </div>
          );
        })}
      </div>
      <Labels points={points} />
    </div>
  );
}
