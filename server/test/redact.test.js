import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { redactPII, assertNoPII } from '../src/services/redact.js';

const sample = (f) => readFile(new URL(`../../samples/${f}`, import.meta.url), 'utf8');

test('removes names, IDs, phones, emails from a real-looking report', async () => {
  const { text, counts } = redactPII(await sample('report-2026-01-lab-a.txt'));
  for (const pii of ['Arjun', 'Mehta', 'Kavita', 'CC-2026-118842', '9876501234', '98765 43210', 'example.com']) {
    assert.ok(!text.includes(pii), `"${pii}" should be redacted`);
  }
  assert.ok(counts.NAME >= 1 && counts.ID >= 1);
  assert.doesNotThrow(() => assertNoPII(text));
});

test('keeps the lab values intact', async () => {
  const { text } = redactPII(await sample('report-2026-01-lab-a.txt'));
  for (const v of ['14.2', '7800', '2.6', 'lakhs/cumm', 'Glucose (Fasting)', '86', '13.0 - 17.0', '12/01/2026']) {
    assert.ok(text.includes(v), `"${v}" should survive redaction`);
  }
});

test('second lab format: DOB, patient ID, doctor', async () => {
  const { text } = redactPII(await sample('report-2026-05-lab-b.txt'));
  for (const pii of ['Arjun', '04/09/1991', 'NG-55120', 'Iyer']) assert.ok(!text.includes(pii), pii);
  assert.ok(text.includes('138') && text.includes('mmol/mol'));
});

test('known names are redacted anywhere in the text', () => {
  const { text } = redactPII('Report prepared for arjun mehta. Arjun should fast.', { knownNames: ['Arjun Mehta'] });
  assert.ok(!/arjun|mehta/i.test(text));
});

test('Aadhaar and PAN numbers', () => {
  const { text } = redactPII('Aadhaar 1234 5678 9012, PAN ABCDE1234F');
  assert.equal(text, 'Aadhaar [AADHAAR], PAN [PAN]');
});

test('fails closed if PII is still present', () => {
  assert.throws(() => assertNoPII('call me at 9876543210'), /PII check failed/);
});

test('does not treat platelet counts as phone numbers', () => {
  const { text } = redactPII('Platelet Count   250000   /cumm   150000 - 450000');
  assert.equal(text, 'Platelet Count   250000   /cumm   150000 - 450000');
});
