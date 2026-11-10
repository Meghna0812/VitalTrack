import { Router } from 'express';
import * as repo from '../db/repo.js';
import { BIOMARKERS } from '../data/biomarkers.js';
import { getBiomarker } from '../services/normalize.js';
import { analyzeSeries } from '../services/trends.js';

export const router = Router();

// The catalog, so the review screen can offer a dropdown of known tests and units.
router.get('/biomarkers', (_req, res) => {
  res.json(BIOMARKERS.map(({ code, name, unit, units, range }) => ({ code, name, unit, units: Object.keys(units), range })));
});

// GET /api/trends?patientId=3&from=2026-08-10
// Trends are always for ONE person; mixing people would be meaningless.
// `from` is optional: only results on/after that date are used, and the slope/projection is
// recalculated for that period – so "last 3 months" shows the recent direction, not the all-time one.
router.get('/trends', async (req, res) => {
  const patientId = Number(req.query.patientId);
  if (!patientId) return res.status(400).json({ error: 'Choose a person first (patientId is required)' });
  if (!(await repo.getPatientForUser(patientId, req.user.id))) return res.status(404).json({ error: 'Not found' });
  const from = req.query.from ?? null;
  if (from !== null && !/^\d{4}-\d{2}-\d{2}$/.test(from)) return res.status(400).json({ error: 'From must be a date like 2026-08-10' });
  const rows = await repo.getTrustedSeries(patientId, from);

  const byCode = new Map();
  for (const r of rows) {
    if (!byCode.has(r.biomarker_code)) byCode.set(r.biomarker_code, []);
    byCode.get(r.biomarker_code).push(r);
  }

  const trends = [];
  for (const [code, series] of byCode) {
    const bm = getBiomarker(code);
    const last = series.at(-1);
    // Use the most recent lab's range if it printed one; otherwise the catalog default.
    const range = last.ref_low != null || last.ref_high != null ? [last.ref_low, last.ref_high] : bm.range;
    const points = series.map((p) => ({ date: p.date, value: p.value, reportId: p.report_id }));
    trends.push({ code, name: bm.name, unit: bm.unit, range, points, ...analyzeSeries(points, range) });
  }

  const priority = { abnormal: 0, approaching_high: 1, approaching_low: 1, none: 2 };
  trends.sort((a, b) => priority[a.flag] - priority[b.flag] || a.name.localeCompare(b.name));
  res.json(trends);
});
