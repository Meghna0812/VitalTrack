// The API server. Run with `npm run dev` (development) or `npm start` (production).
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { requireAuth } from './services/auth.js';
import { router as auth } from './routes/auth.js';
import { router as reports } from './routes/reports.js';
import { router as trends } from './routes/trends.js';
import { router as patients } from './routes/patients.js';

const app = express();

// Behind a hosting provider's proxy/load balancer: trust its X-Forwarded-* headers,
// so req.ip is the real visitor (needed for rate limiting) and HTTPS is detected.
app.set('trust proxy', 1);

// In development the React app runs on a different port (Vite, 5173), so it needs CORS.
// In production the API serves the React app itself – same address, no CORS needed.
if (!config.production) app.use(cors({ origin: config.clientOrigin, credentials: true }));
app.use(express.json());
app.use(cookieParser()); // fills req.cookies, where the session token is read from

// ---- Public routes (no sign-in needed) ----
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api', auth);

// ---- Everything below requires a signed-in user ----
// One line protects every data route, so a new route can't accidentally be left open.
app.use('/api', requireAuth);
app.use('/api', patients);
app.use('/api', reports);
app.use('/api', trends);

// ---- The React app (production build) ----
// The Docker image copies client/dist into server/public. Any non-API URL gets index.html,
// and React decides what to show.
const publicDir = new URL('../public/', import.meta.url).pathname;
if (existsSync(publicDir)) {
  app.use(express.static(publicDir, { index: false, maxAge: '1h' }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api')) return next();
    res.sendFile('index.html', { root: publicDir });
  });
}

// Express 5 forwards errors from async handlers here automatically.
app.use((err, _req, res, _next) => {
  console.error(err);
  // Don't leak internal details (SQL errors, stack traces) for unexpected 500s.
  const status = err.status ?? 500;
  res.status(status).json({ error: status === 500 ? 'Something went wrong on the server' : err.message });
});

app.listen(config.port, () => console.log(`API listening on port ${config.port}`));

// On free hosting a separate background worker costs extra, so the worker can run here instead.
if (config.runWorker) await import('./worker.js');
