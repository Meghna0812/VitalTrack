import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api.js';
import { formatDate, sentence } from '../format.js';
import Icon from './Icon.jsx';

const STATUS_LABEL = {
  queued: 'Queued', processing: 'Processing…', needs_review: 'Needs review', done: 'Ready', failed: 'Failed',
};

export default function Reports({ patient, onOpen }) {
  const [reports, setReports] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(
    () => api.listReports(patient.id).then(setReports).catch((e) => setError(e.message)),
    [patient.id],
  );
  useEffect(() => { load(); }, [load]);

  // Processing happens in the background, so we poll every 3 s while anything is unfinished.
  const busy = reports?.some((r) => r.status === 'queued' || r.status === 'processing');
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [busy, load]);

  async function remove(report) {
    if (!window.confirm(`Delete "${report.original_filename}" and all its results?`)) return;
    try { await api.deleteReport(report.id); load(); } catch (e) { setError(e.message); }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h2>{patient.name}'s reports</h2>
          <p className="muted">Upload a report, add a note so you remember what it was for, then check Trends.</p>
        </div>
      </div>

      <UploadZone patient={patient} onUploaded={load} onError={setError} />
      {error && <p className="error">{sentence(error)}</p>}

      <div className="card list">
        {reports === null && <p className="muted pad">Loading…</p>}
        {reports?.length === 0 && <p className="muted pad">No reports yet for {patient.name}. Upload the first one above.</p>}
        {reports?.map((r) => (
          <div className="report-row" key={r.id}>
            <div className="date-chip">
              <strong>{formatDate(r.report_date ?? r.created_at)}</strong>
            </div>

            <div className="report-main">
              <Description report={r} onSaved={load} onError={setError} />
              <div className="muted small file">{r.original_filename}</div>
              {r.status === 'failed' && <div className="error small">{sentence(r.error)}</div>}
            </div>

            <div className="report-meta">
              <span className={`badge ${r.status}`}>{STATUS_LABEL[r.status]}</span>
              {r.result_count > 0 && (
                <span className="muted small">
                  {r.result_count} results{Number(r.pending_review) > 0 && ` · ${r.pending_review} need review`}
                </span>
              )}
            </div>

            <div className="report-actions">
              {['needs_review', 'done'].includes(r.status) && <button onClick={() => onOpen(r.id)}>Open</button>}
              <button className="icon-btn" title="Delete report" onClick={() => remove(r)}><Icon name="trash" size={16} /></button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// Click "+ Add description" (or the pencil) to edit; Enter or clicking away saves, Escape cancels.
function Description({ report, onSaved, onError }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(report.description ?? '');

  async function save() {
    setEditing(false);
    if (text.trim() === (report.description ?? '')) return; // nothing changed
    try { await api.updateDescription(report.id, text); onSaved(); } catch (e) { onError(e.message); }
  }

  if (editing) {
    return (
      <input className="desc-input" autoFocus value={text} maxLength={500}
        placeholder="e.g. Annual check-up, after starting vitamin D…"
        onChange={(e) => setText(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur(); // blur triggers save
          if (e.key === 'Escape') { setText(report.description ?? ''); setEditing(false); }
        }} />
    );
  }
  return report.description ? (
    <button className="desc" onClick={() => setEditing(true)} title="Edit description">
      {report.description} <Icon name="pencil" size={12} className="muted" />
    </button>
  ) : (
    <button className="link" onClick={() => setEditing(true)}>+ Add description</button>
  );
}

// Drag-and-drop or click to choose. Several files can be uploaded at once.
function UploadZone({ patient, onUploaded, onError }) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(0);
  const input = useRef(null);

  async function upload(files) {
    const list = [...files].filter((f) => /\.(pdf|txt)$/i.test(f.name));
    if (list.length === 0) return onError('Only PDF or .txt files are supported.');
    onError('');
    setUploading(list.length);
    for (const file of list) {
      try { await api.uploadReport(patient.id, file); } catch (e) { onError(`${file.name}: ${e.message}`); }
      setUploading((n) => n - 1);
    }
    onUploaded();
  }

  return (
    <div
      className={`card upload-zone ${dragging ? 'dragging' : ''}`}
      onClick={() => input.current.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); upload(e.dataTransfer.files); }}
    >
      <span className="upload-icon"><Icon name="upload" size={22} /></span>
      <div>
        <strong>{uploading ? `Uploading ${uploading} file(s)…` : `Add reports for ${patient.name}`}</strong>
        <div className="muted small">Drop PDFs here or click to choose · Personal details are removed before AI processing</div>
      </div>
      <input ref={input} type="file" multiple hidden accept=".pdf,.txt,application/pdf,text/plain"
        onChange={(e) => { upload(e.target.files); e.target.value = ''; }} />
    </div>
  );
}
