import { useEffect, useRef, useState } from 'react';

/** Profile photo from Google, or initials on a dark-blue circle. */
export function UserAvatar({ user, size = 38 }) {
  if (user.avatarUrl) {
    // no-referrer: Google photo URLs can refuse requests that carry a Referer header
    return <img className="user-avatar" src={user.avatarUrl} alt="" width={size} height={size} referrerPolicy="no-referrer" />;
  }
  const initials = user.displayName.trim().split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  return <span className="user-avatar initials" style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials}</span>;
}

// Account menu in the top-right corner: who is signed in, profile, sign out.
export default function UserMenu({ user, onProfile, onSignOut }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (!root.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [open]);

  return (
    <div className="picker user-menu" ref={root}>
      <button className="user-button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title="Your account">
        <UserAvatar user={user} />
      </button>
      {open && (
        <div className="picker-menu" role="menu">
          <div className="user-summary">
            <UserAvatar user={user} size={42} />
            <div className="picker-text">
              <strong>{user.displayName}</strong>
              <span className="muted small">{user.email ?? `@${user.username}`}</span>
            </div>
          </div>
          <div className="picker-divider" />
          <button role="menuitem" className="picker-item" onClick={() => { setOpen(false); onProfile(); }}>Your profile</button>
          <button role="menuitem" className="picker-item danger" onClick={() => { setOpen(false); onSignOut(); }}>Sign out</button>
        </div>
      )}
    </div>
  );
}
