import { useEffect, useRef, useState } from 'react';
import { api } from '../api.js';
import { sentence } from '../format.js';
import Icon from './Icon.jsx';

// Loads Google's sign-in library once, only when Google sign-in is configured.
let googleScript;
function loadGoogle() {
  googleScript ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load Google sign-in'));
    document.head.appendChild(s);
  });
  return googleScript;
}

export default function AuthScreen({ onSignedIn }) {
  const [mode, setMode] = useState('signin');     // 'signin' | 'signup'
  const [form, setForm] = useState({ displayName: '', username: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [googleClientId, setGoogleClientId] = useState(null);
  const googleButton = useRef(null);

  const signup = mode === 'signup';
  const set = (field) => (e) => { setForm((f) => ({ ...f, [field]: e.target.value })); setError(''); };

  useEffect(() => { api.authConfig().then((c) => setGoogleClientId(c.googleClientId)).catch(() => {}); }, []);

  // Google renders its own official button into our <div>. When the user picks an account,
  // Google calls `callback` with an ID token, which we send to our backend to verify.
  useEffect(() => {
    if (!googleClientId) return;
    loadGoogle().then(() => {
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async ({ credential }) => {
          setBusy(true);
          try { await api.googleLogin(credential); await onSignedIn(); }
          catch (e) { setError(e.message); setBusy(false); }
        },
      });
      googleButton.current.innerHTML = '';
      window.google.accounts.id.renderButton(googleButton.current, {
        theme: 'outline', size: 'large', shape: 'pill', width: 320,
        text: signup ? 'signup_with' : 'signin_with',
      });
    }).catch((e) => setError(e.message));
  }, [googleClientId, signup]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (signup) await api.register(form);
      else await api.login({ username: form.username, password: form.password });
      await onSignedIn();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  // Live checklist so people see the password rules while typing, not after an error.
  const rules = [
    { ok: form.password.length >= 8, text: 'At least 8 characters' },
    { ok: /[a-zA-Z]/.test(form.password) && /[0-9]/.test(form.password), text: 'A letter and a number' },
  ];

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="auth-brand">
          <span className="logo"><Icon name="heart" size={24} /></span>
          <span>VitalTrack</span>
        </div>
        <h1>{signup ? 'Create your account' : 'Welcome back'}</h1>
        <p className="welcome-lead">{signup ? 'Track blood reports for you and your family.' : 'Sign in to see your reports and trends.'}</p>

        {/* Sign in / Create account switch – same sliding style as the Reports/Trends toggle */}
        <div className={`toggle auth-toggle ${signup ? 'on-right' : ''}`} role="tablist">
          <span className="toggle-pill" aria-hidden="true" />
          <button role="tab" aria-selected={!signup} className={!signup ? 'active' : ''} onClick={() => { setMode('signin'); setError(''); }}>Sign in</button>
          <button role="tab" aria-selected={signup} className={signup ? 'active' : ''} onClick={() => { setMode('signup'); setError(''); }}>Create account</button>
        </div>

        {googleClientId && (
          <>
            <div className="google-btn" ref={googleButton} />
            <div className="or"><span>or</span></div>
          </>
        )}

        <form onSubmit={submit} className="auth-form">
          {signup && (
            <label className="field">
              <span>Your name</span>
              <input value={form.displayName} onChange={set('displayName')} placeholder="e.g. Soumya Gupta" autoComplete="name" maxLength={100} />
            </label>
          )}
          <label className="field">
            <span>Username</span>
            <input value={form.username} onChange={set('username')} placeholder="e.g. soumya_g" autoComplete="username"
              autoCapitalize="none" spellCheck="false" required maxLength={30} />
          </label>
          <label className="field">
            <span>Password</span>
            <div className="password-wrap">
              <input type={showPassword ? 'text' : 'password'} value={form.password} onChange={set('password')}
                autoComplete={signup ? 'new-password' : 'current-password'} required maxLength={72} />
              <button type="button" className="show-pw" onClick={() => setShowPassword((s) => !s)}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </label>
          {signup && (
            <ul className="pw-rules">
              {rules.map((r) => <li key={r.text} className={r.ok ? 'ok' : ''}>{r.ok ? '✓' : '○'} {r.text}</li>)}
            </ul>
          )}

          {error && <p className="error">{sentence(error)}</p>}
          <button className="primary auth-submit" disabled={busy}>
            {busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p className="privacy-hint">🔒 Your reports are private to your account</p>
      </div>
    </div>
  );
}
