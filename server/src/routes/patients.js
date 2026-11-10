// People whose reports are tracked, inside the signed-in account. One account can keep
// separate histories for several people (yourself, a parent…).
// Every route here runs after requireAuth, so req.user is the signed-in user.
import { Router } from 'express';
import { unlink } from 'node:fs/promises';
import * as repo from '../db/repo.js';

export const router = Router();

router.get('/patients', async (req, res) => {
  res.json(await repo.listPatients(req.user.id));
});

router.post('/patients', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: 'Name must be 2–100 characters' });
  res.status(201).json(await repo.createPatient(req.user.id, name));
});

// Remove a person with all their reports, results AND uploaded PDFs (which contain personal data).
router.delete('/patients/:id', async (req, res) => {
  const patient = await repo.getPatientForUser(Number(req.params.id), req.user.id);
  if (!patient) return res.status(404).json({ error: 'Not found' });
  const files = await repo.deletePatient(patient.id);
  await Promise.all(files.map((f) => unlink(f).catch(() => {}))); // a missing file is fine
  res.status(204).end();
});
