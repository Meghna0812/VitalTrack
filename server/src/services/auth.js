// Authentication building blocks: passwords, sessions, rate limiting, Google tokens.
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import * as users from '../db/users.js';

// ---------- Input rules ----------

/** Returns an error message, or null if valid. Pure functions, so they're easy to unit test. */
export function validateUsername(u) {
  if (!/^[a-z0-9._]{3,30}$/.test(u)) return 'Username must be 3–30 characters: letters, numbers, dots or underscores';
  return null;
}
export function validatePassword(p) {
  if (typeof p !== 'string' || p.length < 8) return 'Password must be at least 8 characters';
  if (p.length > 72) return 'Password can be at most 72 characters'; // bcrypt ignores bytes after 72
  if (!/[a-zA-Z]/.test(p) || !/[0-9]/.test(p)) return 'Password must contain at least one letter and one number';
  return null;
}
export const normalizeUsername = (u) => String(u ?? '').trim().toLowerCase();

// ---------- Passwords ----------
// bcrypt is deliberately SLOW (cost 12 ≈ 0.25 s per hash). Irrelevant for one login,
// but it makes guessing millions of passwords from a stolen database impractical.
// Each hash also includes a random "salt", so two users with the same password get different hashes.

const BCRYPT_COST = 12;
export const hashPassword = (password) => bcrypt.hash(password, BCRYPT_COST);
export const checkPassword = (password, hash) => bcrypt.compare(password, hash);

// Used when the username doesn't exist, so the response takes the same time either way.
// Otherwise an attacker could tell "no such user" (fast) from "wrong password" (slow).
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', BCRYPT_COST);
export const burnTime = (password) => bcrypt.compare(password, DUMMY_HASH);

// ---------- Sessions ----------
// After login the browser gets a long random token in a cookie. The database stores only
// the token's SHA-256 hash. Signing out deletes the row, so the session really ends
// (unlike a stateless JWT, which stays valid until it expires).

export const SESSION_COOKIE = 'vt_session';
const SESSION_DAYS = 30;
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export const cookieOptions = {
  httpOnly: true,                                // JavaScript in the page can't read it (protects against XSS theft)
  sameSite: 'lax',                               // not sent on cross-site POSTs (protects against CSRF)
  // HTTPS-only in production. COOKIE_SECURE=false allows testing the production image on plain http://localhost.
  secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : config.production,
  path: '/',
  maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
};

/** Create a session for a user and set the cookie on the response. */
export async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('base64url'); // 256 bits: impossible to guess
  const expires = new Date(Date.now() + cookieOptions.maxAge);
  await users.createSession(userId, sha256(token), expires);
  res.cookie(SESSION_COOKIE, token, cookieOptions);
  users.purgeExpiredSessions().catch(() => {}); // housekeeping, not critical
}

export async function endSession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await users.deleteSession(sha256(token));
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions, maxAge: undefined });
}

/**
 * Middleware for every protected route: finds the user from the session cookie and puts
 * it on req.user. No valid session -> 401, and the frontend shows the sign-in screen.
 */
export async function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  const user = token ? await users.findSessionUser(sha256(token)) : null;
  if (!user) return res.status(401).json({ error: 'Please sign in' });
  req.user = user;
  next();
}

// ---------- Rate limiting ----------
// Limits sign-in attempts per IP address, so nobody can try thousands of passwords.
// The counter lives in Redis (already running for the queue), so it works across restarts
// and across several API processes.

// Same Redis as the queue (incl. password/TLS from REDIS_URL), but fail fast instead of retrying forever.
const redis = new Redis({ ...config.redis, lazyConnect: true, maxRetriesPerRequest: 1 });
const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 20;

export async function authRateLimit(req, res, next) {
  try {
    const key = `ratelimit:auth:${req.ip}`;
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, WINDOW_SECONDS); // start the 15-minute window
    if (count > MAX_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many attempts. Please wait 15 minutes and try again.' });
    }
  } catch {
    // If Redis is down we let the request through rather than locking everyone out.
  }
  next();
}

// ---------- Google ----------
// The browser shows Google's own sign-in button. Google gives it an "ID token": a JWT
// signed by Google that says who the user is. We never trust it blindly: the library checks
// Google's signature, that it hasn't expired, and that it was issued for OUR client ID.

const googleClient = new OAuth2Client();

export async function verifyGoogleToken(credential) {
  if (!config.googleClientId) throw Object.assign(new Error('Google sign-in is not configured'), { status: 400 });
  const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: config.googleClientId });
  const p = ticket.getPayload();
  if (!p?.sub) throw Object.assign(new Error('Invalid Google token'), { status: 401 });
  return { sub: p.sub, email: p.email_verified ? p.email : null, name: p.name || p.email || 'Google user', picture: p.picture ?? null };
}
