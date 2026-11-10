import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDate, sentence } from '../format.js';
import { UserAvatar } from './UserMenu.jsx';

// The signed-in user's own account page.
export default function Profile({ onBack, onUserChange, onSignedOut }) {
  const [me, setMe] = useState(null);
  const [name, setName] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [confirmText, setConfirmText] = useState('');

  useEffect(() => { api.me().then((u) => { setMe(u); setName(u.displayName); }).catch((e) => setError(e.message)); }, []);
  if (!me) return <p className="muted">{error || 'Loading…'}</p>;

  async function saveName(e) {
    e.preventDefault();
    try {
      const u = await api.updateProfile({ displayName: name });
      setMe((m) => ({ ...m, ...u }));
      onUserChange(u);          // update the avatar/name in the top bar too
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) { setError(err.message); }
  }

  async function signOutEverywhere() {
    if (!window.confirm('Sign out on all devices, including this one?')) return;
    await api.logoutAll().catch(() => {});
    onSignedOut();
  }

  async function deleteAccount() {
    await api.deleteAccount();
    onSignedOut();
  }

  return (
    <section className="profile">
      <button className="ghost" onClick={onBack}>← Back</button>

      <div className="card profile-head">
        <UserAvatar user={me} size={72} />
        <div>
          <h2>{me.displayName}</h2>
          <p className="muted">{me.email ?? `@${me.username}`}</p>
          <p className="muted small">
            {me.signInMethod === 'google' ? 'Signs in with Google' : 'Signs in with username & password'} · Member since {formatDate(me.createdAt)}
          </p>
        </div>
        <div className="profile-stats">
          <div><strong>{me.stats.people}</strong><span>People</span></div>
          <div><strong>{me.stats.reports}</strong><span>Reports</span></div>
        </div>
      </div>

      <div className="card">
        <h3>Your name</h3>
        <form className="inline-form" onSubmit={saveName}>
          <input value={name} onChange={(e) => { setName(e.target.value); setError(''); }} maxLength={100} />
          <button className="primary" disabled={name.trim() === me.displayName || name.trim().length < 2}>Save</button>
          {saved && <span className="saved">✓ Saved</span>}
        </form>
        {error && <p className="error">{sentence(error)}</p>}
      </div>

      <div className="card">
        <h3>Sessions</h3>
        <p className="muted">Used a shared or public computer? Sign out everywhere to end every session.</p>
        <button onClick={signOutEverywhere}>Sign out on all devices</button>
      </div>

      <div className="card danger-zone">
        <h3>Delete account</h3>
        <p className="muted">This permanently deletes your account, every person, every report and all uploaded PDFs. It can't be undone.</p>
        <div className="inline-form">
          <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder='Type "DELETE" to confirm' />
          <button className="danger-btn" disabled={confirmText !== 'DELETE'} onClick={deleteAccount}>Delete my account</button>
        </div>
      </div>
    </section>
  );
}
