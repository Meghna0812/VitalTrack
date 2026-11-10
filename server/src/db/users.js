// SQL for accounts and sessions. (Kept separate from repo.js, which is about health data.)
import { pool } from './pool.js';

const USER_FIELDS = 'u.id, u.username, u.email, u.display_name, u.avatar_url, u.created_at, (u.google_sub IS NOT NULL) AS has_google, (u.password_hash IS NOT NULL) AS has_password';

// ---------- Users ----------

export async function getUser(id) {
  const [rows] = await pool.query(`SELECT ${USER_FIELDS} FROM users u WHERE u.id = ?`, [id]);
  return rows[0] ?? null;
}

/** Includes password_hash – only used by the login route, never sent to the browser. */
export async function findByUsername(username) {
  const [rows] = await pool.query('SELECT id, password_hash FROM users WHERE username = ?', [username]);
  return rows[0] ?? null;
}

export async function findByGoogleSub(sub) {
  const [rows] = await pool.query('SELECT id FROM users WHERE google_sub = ?', [sub]);
  return rows[0] ?? null;
}

export async function createLocalUser({ username, passwordHash, displayName }) {
  const [r] = await pool.query(
    'INSERT INTO users (username, password_hash, display_name) VALUES (?, ?, ?)',
    [username, passwordHash, displayName]);
  return r.insertId;
}

export async function createGoogleUser({ googleSub, email, displayName, avatarUrl }) {
  const [r] = await pool.query(
    'INSERT INTO users (google_sub, email, display_name, avatar_url) VALUES (?, ?, ?, ?)',
    [googleSub, email, displayName, avatarUrl]);
  return r.insertId;
}

/** Keep the Google email/photo fresh on every Google sign-in. */
export async function refreshGoogleProfile(id, { email, avatarUrl }) {
  await pool.query('UPDATE users SET email = ?, avatar_url = ? WHERE id = ?', [email, avatarUrl, id]);
}

export async function updateDisplayName(id, displayName) {
  await pool.query('UPDATE users SET display_name = ? WHERE id = ?', [displayName, id]);
}

export async function userStats(id) {
  const [[row]] = await pool.query(`
    SELECT COUNT(DISTINCT p.id) AS people, COUNT(r.id) AS reports
    FROM patients p LEFT JOIN reports r ON r.patient_id = p.id
    WHERE p.user_id = ?`, [id]);
  return { people: Number(row.people), reports: Number(row.reports) };
}

/** Delete an account and everything in it (cascades). Returns uploaded file paths so they can be removed too. */
export async function deleteUser(id) {
  const [files] = await pool.query(
    'SELECT r.file_path FROM reports r JOIN patients p ON p.id = r.patient_id WHERE p.user_id = ?', [id]);
  await pool.query('DELETE FROM users WHERE id = ?', [id]);
  return files.map((f) => f.file_path);
}

/**
 * People created before accounts existed have user_id = NULL. The first account
 * to be created takes them over so existing data isn't lost. Returns how many.
 */
export async function claimUnownedPatients(userId) {
  const [r] = await pool.query('UPDATE patients SET user_id = ? WHERE user_id IS NULL', [userId]);
  return r.affectedRows;
}

export async function createPatientForUser(userId, name) {
  await pool.query('INSERT INTO patients (user_id, name) VALUES (?, ?)', [userId, name]);
}

// ---------- Sessions ----------

export async function createSession(userId, tokenHash, expiresAt) {
  await pool.query('INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)', [userId, tokenHash, expiresAt]);
}

/** The user behind a session token, or null if the session doesn't exist or has expired. */
export async function findSessionUser(tokenHash) {
  const [rows] = await pool.query(
    `SELECT ${USER_FIELDS} FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > NOW()`, [tokenHash]);
  return rows[0] ?? null;
}

export async function deleteSession(tokenHash) {
  await pool.query('DELETE FROM sessions WHERE token_hash = ?', [tokenHash]);
}

export async function deleteAllSessions(userId) {
  await pool.query('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

export async function purgeExpiredSessions() {
  await pool.query('DELETE FROM sessions WHERE expires_at <= NOW()');
}
