// Sign up, sign in (password or Google), sign out, and the user's own profile.
import { Router } from 'express';
import { unlink } from 'node:fs/promises';
import { config } from '../config.js';
import * as users from '../db/users.js';
import {
  validateUsername, validatePassword, normalizeUsername, hashPassword, checkPassword, burnTime,
  startSession, endSession, requireAuth, authRateLimit, verifyGoogleToken,
} from '../services/auth.js';

export const router = Router();

/** What the browser may know about a user (no password hash, no Google ID). */
function publicUser(u) {
  return {
    id: u.id, username: u.username, email: u.email, displayName: u.display_name, avatarUrl: u.avatar_url,
    createdAt: u.created_at, signInMethod: u.has_google ? 'google' : 'password',
  };
}

/**
 * First-time setup for a new account: take over any people created before accounts
 * existed, or else create a "person" for the user themself so they can upload right away.
 */
async function setUpNewAccount(userId, displayName) {
  const claimed = await users.claimUnownedPatients(userId);
  if (claimed === 0) await users.createPatientForUser(userId, displayName);
}

// The frontend asks this to know whether to show the "Sign in with Google" button.
router.get('/auth/config', (_req, res) => {
  res.json({ googleClientId: config.googleClientId || null });
});

router.post('/auth/register', authRateLimit, async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = req.body?.password;
  const displayName = String(req.body?.displayName ?? '').trim() || username;

  const problem = validateUsername(username) ?? validatePassword(password)
    ?? (displayName.length > 100 ? 'Name can be at most 100 characters' : null);
  if (problem) return res.status(400).json({ error: problem });
  if (await users.findByUsername(username)) return res.status(409).json({ error: 'That username is taken' });

  const id = await users.createLocalUser({ username, passwordHash: await hashPassword(password), displayName });
  await setUpNewAccount(id, displayName);
  await startSession(res, id);
  res.status(201).json(publicUser(await users.getUser(id)));
});

router.post('/auth/login', authRateLimit, async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password ?? '');
  const found = await users.findByUsername(username);

  // Same message for "no such user" and "wrong password", so attackers can't discover usernames.
  if (!found?.password_hash) {
    await burnTime(password);
    return res.status(401).json({ error: 'Incorrect username or password' });
  }
  if (!(await checkPassword(password, found.password_hash))) {
    return res.status(401).json({ error: 'Incorrect username or password' });
  }
  await startSession(res, found.id);
  res.json(publicUser(await users.getUser(found.id)));
});

// Body: { credential } – the ID token from Google's sign-in button.
router.post('/auth/google', authRateLimit, async (req, res) => {
  const g = await verifyGoogleToken(String(req.body?.credential ?? ''));
  let user = await users.findByGoogleSub(g.sub);
  if (user) {
    await users.refreshGoogleProfile(user.id, { email: g.email, avatarUrl: g.picture });
  } else {
    const id = await users.createGoogleUser({ googleSub: g.sub, email: g.email, displayName: g.name, avatarUrl: g.picture });
    await setUpNewAccount(id, g.name);
    user = { id };
  }
  await startSession(res, user.id);
  res.json(publicUser(await users.getUser(user.id)));
});

router.post('/auth/logout', async (req, res) => {
  await endSession(req, res);
  res.status(204).end();
});

// ---------- Profile (signed-in only) ----------

router.get('/auth/me', requireAuth, async (req, res) => {
  res.json({ ...publicUser(req.user), stats: await users.userStats(req.user.id) });
});

router.patch('/auth/me', requireAuth, async (req, res) => {
  const displayName = String(req.body?.displayName ?? '').trim();
  if (displayName.length < 2 || displayName.length > 100) return res.status(400).json({ error: 'Name must be 2–100 characters' });
  await users.updateDisplayName(req.user.id, displayName);
  res.json(publicUser(await users.getUser(req.user.id)));
});

// Sign out on every device (e.g. after using a shared computer).
router.post('/auth/logout-all', requireAuth, async (req, res) => {
  await users.deleteAllSessions(req.user.id);
  await endSession(req, res);
  res.status(204).end();
});

// Delete the account and ALL its data, including uploaded PDFs on disk.
router.delete('/auth/me', requireAuth, async (req, res) => {
  const files = await users.deleteUser(req.user.id); // sessions, people, reports, results cascade
  await Promise.all(files.map((f) => unlink(f).catch(() => {})));
  await endSession(req, res);
  res.status(204).end();
});
