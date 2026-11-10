import { Router } from 'express';
import multer from 'multer';
import { mkdirSync } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { config } from '../config.js';
import * as repo from '../db/repo.js';
import { enqueueReport } from '../queue.js';
import { getBiomarker, convert } from '../services/normalize.js';

mkdirSync(config.uploadDir, { recursive: true });

// multer handles multipart/form-data (file uploads). We limit size and type up front.
const upload = multer({
  dest: config.uploadDir,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => cb(null, ['application/pdf', 'text/plain'].includes(file.mimetype)),
});

// Every route here runs after requireAuth, and every lookup is a "...ForUser" query,
// so users can only ever see and change their own reports.
export const router = Router();

// Upload: save file, create DB row, queue the job, answer immediately with 202 Accepted.
// The form sends two fields: `file` (the PDF) and `patientId` (whose report it is).
router.post('/reports', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF or .txt file in the "file" field' });
  // The person must belong to the signed-in account – otherwise you could upload into someone else's history.
  const patient = await repo.getPatientForUser(Number(req.body?.patientId), req.user.id);
  if (!patient) {
    await unlink(req.file.path).catch(() => {}); // don't keep files nobody owns
    return res.status(400).json({ error: 'Choose a valid person (patientId) for this report' });
  }
  const id = await repo.createReport({
    patientId: patient.id,
    originalFilename: req.file.originalname,
    filePath: req.file.path,
    mimeType: req.file.mimetype,
  });
  await enqueueReport(id);
  res.status(202).json({ id, status: 'queued' });
});

// GET /api/reports?patientId=3 – one person's reports.
router.get('/reports', async (req, res) => {
  const patientId = Number(req.query.patientId);
  if (!patientId) return res.status(400).json({ error: 'Choose a person first (patientId is required)' });
  if (!(await repo.getPatientForUser(patientId, req.user.id))) return res.status(404).json({ error: 'Not found' });
  res.json(await repo.listReports(patientId));
});

// Edit the user's own note for a report, e.g. "Annual check-up" or "After starting vitamin D".
router.patch('/reports/:id', async (req, res) => {
  const report = await repo.getReportForUser(Number(req.params.id), req.user.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  const description = String(req.body?.description ?? '').trim();
  if (description.length > 500) return res.status(400).json({ error: 'Description can be at most 500 characters' });
  await repo.updateDescription(report.id, description || null); // empty text = remove the description
  res.json({ id: report.id, description: description || null });
});

// Delete a report: the database rows AND the uploaded file (it contains personal data).
router.delete('/reports/:id', async (req, res) => {
  const report = await repo.getReportForUser(Number(req.params.id), req.user.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  await repo.deleteReport(report.id);
  await unlink(report.file_path).catch(() => {});
  res.status(204).end();
});

router.get('/reports/:id', async (req, res) => {
  const report = await repo.getReportForUser(Number(req.params.id), req.user.id);
  if (!report) return res.status(404).json({ error: 'Not found' });
  const { file_path, ...safe } = report; // don't expose server file paths
  res.json({ ...safe, results: await repo.getResults(report.id) });
});

// Human review: confirm or correct a flagged result.
// Body: { biomarkerCode, value, unit } – value/unit as printed; we convert to canonical here.
router.patch('/results/:id', async (req, res) => {
  const result = await repo.getResultForUser(Number(req.params.id), req.user.id);
  if (!result) return res.status(404).json({ error: 'Not found' });

  const { biomarkerCode, value, unit } = req.body ?? {};
  const bm = getBiomarker(biomarkerCode);
  if (!bm) return res.status(400).json({ error: 'Unknown biomarkerCode' });
  const num = Number(value);
  if (!Number.isFinite(num)) return res.status(400).json({ error: 'Value must be a number' });
  const canonical = convert(bm, num, unit || bm.unit);
  if (canonical === undefined) {
    return res.status(400).json({ error: `Unit "${unit}" not supported for ${bm.name}`, units: Object.keys(bm.units) });
  }

  // Keep the lab's range only if the reviewer kept the same biomarker; otherwise use the catalog default.
  const sameTest = biomarkerCode === result.biomarker_code && (result.ref_low != null || result.ref_high != null);
  const refLow = sameTest ? result.ref_low : bm.range[0];
  const refHigh = sameTest ? result.ref_high : bm.range[1];
  const flag = refLow != null && canonical < refLow ? 'low' : refHigh != null && canonical > refHigh ? 'high' : 'normal';

  await repo.updateReviewedResult(result.id, { biomarkerCode, value: canonical, unit: bm.unit, refLow, refHigh, flag });
  await repo.refreshReportStatus(result.report_id);
  res.json(await repo.getResult(result.id));
});

// Human review: discard a result that shouldn't exist (e.g. a page number read as a value).
router.delete('/results/:id', async (req, res) => {
  const result = await repo.getResultForUser(Number(req.params.id), req.user.id);
  if (!result) return res.status(404).json({ error: 'Not found' });
  await repo.deleteResult(result.id);
  await repo.refreshReportStatus(result.report_id);
  res.status(204).end();
});
