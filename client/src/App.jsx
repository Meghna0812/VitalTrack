import { useEffect, useState } from 'react';
import { api, setUnauthorizedHandler } from './api.js';
import AuthScreen from './components/AuthScreen.jsx';
import AddPerson from './components/AddPerson.jsx';
import Reports from './components/Reports.jsx';
import ReportDetail from './components/ReportDetail.jsx';
import Trends from './components/Trends.jsx';
import Profile from './components/Profile.jsx';
import Icon from './components/Icon.jsx';
import PersonPicker from './components/PersonPicker.jsx';
import UserMenu from './components/UserMenu.jsx';

/**
 * Top level: decides between "checking session", the sign-in screen, and the app itself.
 *   user === undefined -> still asking the server who we are
 *   user === null      -> signed out
 *   user = {...}       -> signed in
 */
export default function App() {
  const [user, setUser] = useState(undefined);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null)); // any 401 anywhere -> back to sign-in
    api.me()
      .then(setUser)
      .catch((e) => (e.status === 401 ? setUser(null) : setOffline(true)));
  }, []);

  if (offline) return <div className="app"><p className="error">Could not reach the server. Is the API running?</p></div>;
  if (user === undefined) return <div className="app"><p className="muted">Loading…</p></div>;
  if (!user) return <AuthScreen onSignedIn={() => api.me().then(setUser)} />;

  // key={user.id}: if a different user signs in, everything below starts fresh (no leftover data).
  return <Workspace key={user.id} user={user} onUserChange={setUser} onSignedOut={() => setUser(null)} />;
}

// The selected person is remembered per account, so two accounts on one computer don't mix.
const storageKey = (userId) => `vitaltrack.patientId.${userId}`;
const loadStoredId = (userId) => { try { return Number(localStorage.getItem(storageKey(userId))) || null; } catch { return null; } };
const storeId = (userId, id) => { try { localStorage.setItem(storageKey(userId), String(id)); } catch { /* not critical */ } };

function Workspace({ user, onUserChange, onSignedOut }) {
  const [patients, setPatients] = useState(null);   // null = still loading
  const [patientId, setPatientId] = useState(() => loadStoredId(user.id));
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState({ name: 'reports' });
  const [error, setError] = useState('');

  const loadPatients = () => api.listPatients().then(setPatients).catch((e) => setError(e.message));
  useEffect(() => { loadPatients(); }, []);

  async function signOut() {
    await api.logout().catch(() => {});
    onSignedOut();
  }

  const userMenu = <UserMenu user={user} onProfile={() => setView({ name: 'profile' })} onSignOut={signOut} />;

  if (error) return <div className="app"><p className="error">{error}</p></div>;
  if (!patients) return <div className="app"><p className="muted">Loading…</p></div>;

  // Use the remembered person if they still exist, otherwise the first one.
  const patient = patients.find((p) => p.id === patientId) ?? patients[0] ?? null;

  function choosePatient(id) {
    setPatientId(id);
    storeId(user.id, id);
    setView((v) => (v.name === 'report' ? { name: 'reports' } : v)); // a report belongs to the previous person
  }

  // After removing someone we fall back to the first remaining person. If nobody is left,
  // `patient` becomes null and the "Add a person" screen appears automatically (see below).
  async function removePatient(id) {
    try {
      await api.deletePatient(id);
      setPatients((list) => list.filter((p) => p.id !== id));
      setView({ name: 'reports' });
    } catch (e) {
      window.alert(e.message);
    }
  }

  async function addPatient(name) {
    const p = await api.createPatient(name);
    setPatients((list) => [...list, { ...p, report_count: 0 }]);
    choosePatient(p.id);
    setAdding(false);
  }

  const brand = <div className="brand"><span className="logo"><Icon name="heart" size={24} /></span>VitalTrack</div>;

  // The profile page works even when the account has no people yet.
  if (view.name === 'profile') {
    return (
      <div className="app">
        <header className="topbar">{brand}{userMenu}</header>
        <Profile onBack={() => setView({ name: 'reports' })} onUserChange={onUserChange} onSignedOut={onSignedOut} />
      </div>
    );
  }

  // No people yet, or "Add a person" clicked: ask for a name before anything else.
  if (!patient || adding) {
    return (
      <div className="app">
        <header className="topbar">{brand}{userMenu}</header>
        <AddPerson first={!patient} onAdd={addPatient} onCancel={patient ? () => setAdding(false) : null} />
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        {brand}

        {/* A sliding toggle: one pill moves behind the active option (CSS transform + transition). */}
        <nav className={`toggle ${view.name === 'trends' ? 'on-right' : ''}`} role="tablist" aria-label="Section">
          <span className="toggle-pill" aria-hidden="true" />
          <button role="tab" aria-selected={view.name !== 'trends'} className={view.name !== 'trends' ? 'active' : ''}
            onClick={() => setView({ name: 'reports' })}>
            <Icon name="doc" size={16} /> Reports
          </button>
          <button role="tab" aria-selected={view.name === 'trends'} className={view.name === 'trends' ? 'active' : ''}
            onClick={() => setView({ name: 'trends' })}>
            <Icon name="chart" size={16} /> Trends
          </button>
        </nav>

        <div className="topbar-right">
          <PersonPicker patients={patients} current={patient} onChoose={choosePatient}
            onAdd={() => setAdding(true)} onRemove={removePatient} onOpen={loadPatients} />
          {userMenu}
        </div>
      </header>

      <main>
        {/* key={patient.id} remounts the screen when the person changes, so no stale data is shown */}
        {view.name === 'reports' && <Reports key={patient.id} patient={patient} onOpen={(id) => setView({ name: 'report', id })} />}
        {view.name === 'report' && <ReportDetail id={view.id} onBack={() => setView({ name: 'reports' })} />}
        {view.name === 'trends' && <Trends key={patient.id} patient={patient} />}
      </main>
    </div>
  );
}
