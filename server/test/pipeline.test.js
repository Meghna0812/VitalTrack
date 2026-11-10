// Tests the whole pipeline with a FAKE LLM, so no API key or network is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processText } from '../src/services/pipeline.js';

const report = `Patient Name: Mr. Arjun Mehta   UHID: CC-1
Haemoglobin   14.2   gm/dL   13.0 - 17.0
SGPT (ALT)    28     U/L     < 45`;

test('the LLM only ever sees redacted text', async () => {
  let seen = '';
  const fakeLLM = async (text) => { seen = text; return { reportDate: null, biomarkers: [] }; };
  await processText(report, { llm: fakeLLM });
  assert.ok(!seen.includes('Arjun') && !seen.includes('CC-1'));
});

test('good results pass, hallucinated or uncertain ones go to review', async () => {
  const fakeLLM = async () => ({
    reportDate: '2026-01-12',
    biomarkers: [
      { name: 'Haemoglobin', value: 14.2, unit: 'gm/dL', refLow: 13, refHigh: 17, confidence: 0.98, sourceText: '' },
      { name: 'SGPT (ALT)', value: 82, unit: 'U/L', refLow: null, refHigh: 45, confidence: 0.95, sourceText: '' }, // 82 is not in the text
      { name: 'Mystery Marker', value: 28, unit: 'U/L', refLow: null, refHigh: null, confidence: 0.6, sourceText: '' },
    ],
  });
  const { results } = await processText(report, { llm: fakeLLM, threshold: 0.8 });
  assert.equal(results[0].needsReview, false);
  assert.equal(results[0].biomarkerCode, 'HGB');
  assert.equal(results[1].needsReview, true);
  assert.match(results[1].reviewReasons.join(), /does not appear/);
  assert.equal(results[2].needsReview, true);
  assert.match(results[2].reviewReasons.join(), /unknown test name.*confidence/s);
});
