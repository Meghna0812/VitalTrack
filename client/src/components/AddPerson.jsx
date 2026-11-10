import { useState } from 'react';
import Icon from './Icon.jsx';
import { Avatar } from './PersonPicker.jsx';
import { sentence } from '../format.js';

// Shown on first visit (nobody added yet) and when "+ Add a person" is clicked.
export default function AddPerson({ first, onAdd, onCancel }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const trimmed = name.trim();
  const ready = trimmed.length >= 2; // the button only turns on once the name is valid

  async function submit(e) {
    e.preventDefault(); // stop the browser's default full-page form submit
    if (!ready) return setError('Please enter at least 2 characters.');
    setSaving(true);
    try { await onAdd(trimmed); } catch (err) { setError(err.message); setSaving(false); }
  }

  return (
    <div className="welcome card">
      {/* Live preview: as you type, the avatar shows the initials this person will get */}
      {ready
        ? <Avatar person={{ id: 0, name: trimmed }} size={60} />
        : <span className="welcome-icon"><Icon name="user" size={28} /></span>}

      <h1>{first ? 'Welcome to VitalTrack' : 'Add a person'}</h1>
      <p className="welcome-lead">Who are these reports for?</p>

      <form onSubmit={submit}>
        <label className="name-field">
          <Icon name="user" size={18} className="field-icon" />
          <input autoFocus placeholder="Full name, e.g. Soumya Gupta" value={name} aria-label="Full name"
            onChange={(e) => { setName(e.target.value); setError(''); }} maxLength={100} />
        </label>
        <button className="primary continue" disabled={!ready || saving}>
          {saving ? 'Saving…' : <>Continue <span aria-hidden="true">→</span></>}
        </button>
      </form>
      {error && <p className="error">{sentence(error)}</p>}

      <p className="muted small">Each person gets their own reports and health trends.</p>
      <p className="privacy-hint">🔒 Your name is never shared with the AI</p>

      {onCancel && <button className="ghost back" onClick={onCancel}>← Back</button>}
    </div>
  );
}
