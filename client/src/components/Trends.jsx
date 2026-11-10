import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { CATEGORIES, categoryOf } from '../categories.js';
import { formatDate, formatValue, formatRange, monthsAgo, toISODate, sentence } from '../format.js';
import { MiniLine, MiniBars } from './MiniCharts.jsx';
import Icon from './Icon.jsx';

// The time windows the user can pick. `months: null` = everything.
const PERIODS = [
  { id: '3m', label: 'Last 3 months', months: 3 },
  { id: '6m', label: 'Last 6 months', months: 6 },
  { id: 'all', label: 'All time', months: null },
];

// Plain-language status under the big number, like "Stable weight" / "On track" in the design.
function statusText(t) {
  if (t.flag === 'abnormal') return { text: t.status === 'high' ? 'Above range' : 'Below range', tone: 'bad' };
  if (t.flag === 'approaching_high') return { text: 'Rising toward high', tone: 'warn' };
  if (t.flag === 'approaching_low') return { text: 'Falling toward low', tone: 'warn' };
  if (t.direction === 'insufficient_data') return { text: 'In range · 1 result', tone: 'ok' };
  return { text: t.direction === 'stable' ? 'Stable · In range' : 'In range', tone: 'ok' };
}

export default function Trends({ patient }) {
  const [period, setPeriod] = useState('all');   // default: the whole history
  const [trends, setTrends] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');   // 'all' | 'attention' | 'ok' | a category id
  const [error, setError] = useState('');

  const months = PERIODS.find((p) => p.id === period).months;
  const from = months ? toISODate(monthsAgo(months)) : null;

  // Re-fetch whenever the person or period changes. The server recalculates each trend
  // (slope, projection, flag) using only the results inside the period.
  useEffect(() => {
    let cancelled = false; // ignore a slow old response if the user already picked another period
    setLoading(true);
    api.trends(patient.id, from)
      .then((data) => { if (!cancelled) { setTrends(data); setError(''); } })
      .catch((e) => { if (!cancelled) setError(e.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [patient.id, from]);

  if (error) return <p className="error">{sentence(error)}</p>;
  if (!trends) return <p className="muted">Loading…</p>;

  // The dates shown under the title: the chosen window, or first → latest result for "All time".
  const allDates = trends.flatMap((t) => t.points.map((p) => p.date)).sort();
  const rangeStart = from ?? allDates[0];
  const rangeEnd = from ? toISODate(new Date()) : allDates.at(-1);

  const attention = trends.filter((t) => t.flag !== 'none');
  const presentCategories = Object.keys(CATEGORIES).filter((c) => trends.some((t) => categoryOf(t.code) === c));
  const visible = trends.filter((t) =>
    filter === 'all' ? true
      : filter === 'attention' ? t.flag !== 'none'
        : filter === 'ok' ? t.flag === 'none'
          : categoryOf(t.code) === filter);

  // Clicking a tile filters the cards; clicking the active tile again shows everything.
  const toggleFilter = (f) => setFilter((cur) => (cur === f ? 'all' : f));

  return (
    <section className={loading ? 'is-loading' : ''}>
      <div className="page-head">
        <div>
          <h2>{patient.name}'s health trends</h2>
          {rangeStart && (
            <p className="date-range">
              <Icon name="calendar" size={15} /> {formatDate(rangeStart)} – {formatDate(rangeEnd)}
            </p>
          )}
        </div>
        <div className="segmented" role="tablist" aria-label="Time period">
          {PERIODS.map((p) => (
            <button key={p.id} role="tab" aria-selected={period === p.id}
              className={period === p.id ? 'active' : ''} onClick={() => setPeriod(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {trends.length === 0 ? (
        <div className="card empty">
          {period === 'all' ? (
            <>
              <h2>No trends yet for {patient.name}</h2>
              <p className="muted">Upload a report on the Reports tab. Once it's processed (and any flagged values are reviewed), its results appear here.</p>
            </>
          ) : (
            <>
              <h2>No results in this period</h2>
              <p className="muted">There are no reports between {formatDate(rangeStart)} and {formatDate(rangeEnd)}.</p>
              <button className="primary" onClick={() => setPeriod('all')}>Show all time</button>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="summary">
            <button className={`summary-tile warn ${filter === 'attention' ? 'active' : ''}`} onClick={() => toggleFilter('attention')}>
              <strong>{attention.length}</strong><span>Need attention</span>
            </button>
            <button className={`summary-tile ok ${filter === 'ok' ? 'active' : ''}`} onClick={() => toggleFilter('ok')}>
              <strong>{trends.length - attention.length}</strong><span>In range &amp; steady</span>
            </button>
            <p className="muted small summary-note">
              {trends.length} biomarkers · Values from different labs are converted to the same unit
            </p>
          </div>

          <div className="chips">
            <button className={filter === 'all' ? 'chip active' : 'chip'} onClick={() => setFilter('all')}>All</button>
            {presentCategories.map((c) => (
              <button key={c} className={filter === c ? 'chip active' : 'chip'} onClick={() => setFilter(c)}>{CATEGORIES[c].label}</button>
            ))}
          </div>

          {visible.length === 0 ? (
            <div className="card empty">
              <p className="muted">
                {filter === 'attention' ? 'Nothing needs attention in this period. 🎉' : 'No biomarkers match this filter.'}
              </p>
            </div>
          ) : (
            <div className="metric-grid">
              {visible.map((t) => <MetricCard key={t.code} trend={t} />)}
            </div>
          )}
        </>
      )}
      <p className="muted small disclaimer">Trend flags are an automatic screening aid, not medical advice. Discuss results with a doctor.</p>
    </section>
  );
}

function MetricCard({ trend: t }) {
  const cat = CATEGORIES[categoryOf(t.code)];
  const latest = t.points.at(-1);
  const status = statusText(t);
  const Chart = cat.chart === 'bars' ? MiniBars : MiniLine;

  return (
    <article className={`metric-card ${status.tone}`}>
      <header>
        <span className="metric-title">
          <span className="metric-icon" style={{ color: cat.color, background: `${cat.color}1a` }}>
            <Icon name={cat.icon} size={16} />
          </span>
          {t.name}
        </span>
        <span className="muted small">{formatDate(latest.date)}</span>
      </header>

      <div className="metric-body">
        <div className="metric-value">
          <div><span className="big">{formatValue(latest.value)}</span> <span className="unit">{t.unit}</span></div>
          <div className={`status ${status.tone}`}>{status.text}</div>
          <div className="muted small">Normal {formatRange(t.range[0], t.range[1])}</div>
        </div>
        <Chart points={t.points} range={t.range} color={cat.color} id={t.code} />
      </div>

      {t.projected != null && t.flag !== 'none' && (
        <footer className="muted small">Projected ~{formatValue(t.projected)} {t.unit} in 90 days if the trend continues</footer>
      )}
    </article>
  );
}
