import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';

// A custom dropdown instead of a plain <select>: a native select can't show avatars,
// report counts or an "Add person" action, and can't be styled consistently across browsers.

const AVATAR_COLORS = ['#3b82f6', '#e5484d', '#12a594', '#8e4ec6', '#f76b15', '#0ea5e9', '#d6409f'];
export const avatarColor = (id) => AVATAR_COLORS[id % AVATAR_COLORS.length];

/** "Arjun Mehta" -> "AM", "Mom" -> "M" */
const initials = (name) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export function Avatar({ person, size = 34 }) {
  return (
    <span className="avatar" style={{ width: size, height: size, background: avatarColor(person.id), fontSize: size * 0.38 }}>
      {initials(person.name)}
    </span>
  );
}

export default function PersonPicker({ patients, current, onChoose, onAdd, onRemove, onOpen }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);

  // Close when clicking anywhere outside the picker, or pressing Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (!root.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  function toggle() {
    if (!open) onOpen?.(); // refresh report counts when the menu opens
    setOpen(!open);
  }

  const count = (p) => `${p.report_count} report${Number(p.report_count) === 1 ? '' : 's'}`;

  return (
    <div className="picker" ref={root}>
      <button className="picker-button" onClick={toggle} aria-haspopup="listbox" aria-expanded={open}>
        <Avatar person={current} />
        <span className="picker-text">
          <span className="picker-label">Viewing</span>
          <strong>{current.name}</strong>
        </span>
        <svg className={`chevron ${open ? 'up' : ''}`} width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="picker-menu" role="listbox">
          <div className="picker-heading">Switch person</div>
          {patients.map((p) => (
            // Two separate buttons side by side: a button can't contain another button in valid HTML.
            <div key={p.id} className={`picker-row ${p.id === current.id ? 'selected' : ''}`}>
              <button role="option" aria-selected={p.id === current.id} className="picker-item"
                onClick={() => { onChoose(p.id); setOpen(false); }}>
                <Avatar person={p} size={30} />
                <span className="picker-text">
                  <strong>{p.name}</strong>
                  <span className="muted small">{count(p)}</span>
                </span>
                {p.id === current.id && <span className="check">✓</span>}
              </button>
              <button className="icon-btn picker-remove" title={`Remove ${p.name}`} aria-label={`Remove ${p.name}`}
                onClick={() => {
                  if (window.confirm(`Remove ${p.name} and all of their reports? This can't be undone.`)) {
                    setOpen(false);
                    onRemove(p.id);
                  }
                }}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
          <div className="picker-divider" />
          <button className="picker-item add" onClick={() => { setOpen(false); onAdd(); }}>
            <span className="add-icon"><Icon name="user" size={15} /></span>
            <strong>Add a person</strong>
          </button>
        </div>
      )}
    </div>
  );
}
