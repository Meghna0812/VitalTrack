import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { formatDate, formatValue, formatRange, sentence } from '../format.js';

const FLAG_LABEL = { low: 'Low', normal: 'Normal', high: 'High' };

export default function ReportDetail({ id, onBack }) {
  const [report, setReport] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [error, setError] = useState('');

  const load = useCallback(() => api.getReport(id).then(setReport).catch((e) => setError(e.message)), [id]);
  useEffect(() => { load(); api.biomarkers().then(setCatalog); }, [load]);

  if (!report) return <p>{error || 'Loading…'}</p>;
  const flagged = report.results.filter((r) => r.needs_review);
  const trusted = report.results.filter((r) => !r.needs_review);

  return (
    <section>
      <button className="ghost" onClick={onBack}>← Back to reports</button>
      <div className="page-head">
        <div>
          <h2>{report.description || report.original_filename}</h2>
          <p className="muted">
            {report.patient_name} · {formatDate(report.report_date ?? report.created_at)}
            {report.description && ` · ${report.original_filename}`}
          </p>
          <p className="privacy-note">🔒 Your personal identification is removed before AI processing.</p>
        </div>
      </div>
      {error && <p className="error">{sentence(error)}</p>}

      {flagged.length > 0 && (
        <div className="card review">
          <h3>Needs your review ({flagged.length})</h3>
          <p className="muted">These were not saved as trusted because an automatic check failed. Confirm, correct or discard each one.</p>
          {flagged.map((r) => (
            <ReviewRow key={r.id} result={r} catalog={catalog} onDone={load} onError={setError} />
          ))}
        </div>
      )}

      <h3>Results</h3>
      <div className="card table-card">
        <table className="results-table">
          <thead><tr><th>Test</th><th>As printed</th><th>Normalized</th><th>Normal range</th><th>Status</th></tr></thead>
          <tbody>
            {trusted.map((r) => (
              <tr key={r.id}>
                {/* data-label: on phones each row becomes a small card and CSS shows these as labels */}
                <td data-label="Test" className="cell-test">{catalog.find((b) => b.code === r.biomarker_code)?.name ?? r.biomarker_code}</td>
                <td data-label="As printed" className="muted"><span>{r.raw_name}: {r.raw_value} {r.raw_unit}</span></td>
                <td data-label="Normalized"><span><strong>{formatValue(r.value)}</strong> {r.unit}</span></td>
                <td data-label="Normal range"><span>{formatRange(r.ref_low, r.ref_high)}</span></td>
                <td data-label="Status" className="cell-status"><span className={`badge ${r.flag}`}>{FLAG_LABEL[r.flag] ?? r.flag}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReviewRow({ result, catalog, onDone, onError }) {
  const [code, setCode] = useState(result.biomarker_code ?? '');
  const [value, setValue] = useState(String(result.raw_value));
  const [unit, setUnit] = useState(result.raw_unit ?? '');
  const bm = catalog.find((b) => b.code === code);

  async function save() {
    try { await api.reviewResult(result.id, { biomarkerCode: code, value, unit }); onDone(); }
    catch (e) { onError(e.message); }
  }
  async function discard() {
    try { await api.deleteResult(result.id); onDone(); }
    catch (e) { onError(e.message); }
  }

  return (
    <div className="review-row">
      <div>
        <strong>{result.raw_name}</strong>: {result.raw_value} {result.raw_unit}
        <span className="muted"> · AI confidence {Math.round(result.confidence * 100)}%</span>
        <ul className="reasons">{(result.review_reasons ?? []).map((reason) => <li key={reason}>{sentence(reason)}</li>)}</ul>
        {result.source_text && <code className="source">{result.source_text}</code>}
      </div>
      <div className="review-form">
        <select value={code} onChange={(e) => { setCode(e.target.value); setUnit(''); }}>
          <option value="">Choose test…</option>
          {catalog.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
        <input value={value} onChange={(e) => setValue(e.target.value)} size="8" />
        <select value={unit} onChange={(e) => setUnit(e.target.value)} disabled={!bm}>
          <option value="">{bm ? bm.unit : 'Unit'}</option>
          {bm?.units.map((u) => <option key={u} value={u}>{u}</option>)}
        </select>
        <button className="primary" onClick={save} disabled={!code}>Confirm</button>
        <button onClick={discard}>Discard</button>
      </div>
    </div>
  );
}
