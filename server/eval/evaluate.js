// Measures extraction accuracy against hand-checked answers ("ground truth").
//
// Usage:  npm run eval                 (uses ../samples)
//         npm run eval -- /path/to/dir
//
// For every report file (report.pdf or report.txt) put a report.truth.json next to it:
//   { "reportDate": "2026-01-12", "expected": { "HGB": 14.2, "GLU_F": 86, ... } }
// with values in CANONICAL units (see src/data/biomarkers.js).
//
// This calls the real DeepSeek API, so DEEPSEEK_API_KEY must be set in .env.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { extractText } from '../src/services/textExtract.js';
import { processText } from '../src/services/pipeline.js';

const dir = path.resolve(process.argv[2] ?? new URL('../../samples', import.meta.url).pathname);
const files = (await readdir(dir)).filter((f) => /\.(pdf|txt)$/i.test(f));

const close = (a, b) => Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.01); // within 1%

const totals = { expected: 0, correct: 0, missing: 0, wrong: 0, wrongFlagged: 0, silentErrors: 0, extra: 0, flaggedCorrect: 0 };

for (const file of files) {
  const truthPath = path.join(dir, file.replace(/\.(pdf|txt)$/i, '.truth.json'));
  let truth;
  try { truth = JSON.parse(await readFile(truthPath, 'utf8')); } catch { console.log(`skip ${file} (no truth file)`); continue; }

  const mime = file.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'text/plain';
  const out = await processText(await extractText(path.join(dir, file), mime));
  const got = new Map(out.results.filter((r) => r.biomarkerCode).map((r) => [r.biomarkerCode, r]));

  const problems = [];
  for (const [code, want] of Object.entries(truth.expected)) {
    totals.expected++;
    const r = got.get(code);
    if (!r) { totals.missing++; problems.push(`  missing  ${code}`); continue; }
    if (r.value != null && close(r.value, want)) {
      totals.correct++;
      if (r.needsReview) totals.flaggedCorrect++;
    } else {
      totals.wrong++;
      if (r.needsReview) totals.wrongFlagged++; else totals.silentErrors++;
      problems.push(`  wrong    ${code}: got ${r.value}, want ${want}${r.needsReview ? ' (flagged for review)' : '  <-- SILENT ERROR'}`);
    }
  }
  for (const code of got.keys()) if (!(code in truth.expected)) { totals.extra++; problems.push(`  extra    ${code}`); }
  if (truth.reportDate && out.reportDate !== truth.reportDate) problems.push(`  date     got ${out.reportDate}, want ${truth.reportDate}`);

  const n = Object.keys(truth.expected).length;
  const ok = n - problems.filter((p) => /missing|wrong/.test(p)).length;
  console.log(`${file}: ${ok}/${n} correct`);
  problems.forEach((p) => console.log(p));
}

const pct = (a, b) => (b ? ((100 * a) / b).toFixed(1) + '%' : 'n/a');
console.log('\n===== Summary =====');
console.log(`Reports evaluated:      ${files.length}`);
console.log(`Biomarkers expected:    ${totals.expected}`);
console.log(`Correct:                ${totals.correct}  (accuracy ${pct(totals.correct, totals.expected)})`);
console.log(`Missing:                ${totals.missing}`);
console.log(`Wrong but flagged:      ${totals.wrongFlagged}`);
console.log(`Wrong and NOT flagged:  ${totals.silentErrors}  <- silent errors, the number that matters most`);
console.log(`Extra (not in truth):   ${totals.extra}`);
console.log(`Correct but flagged:    ${totals.flaggedCorrect}  (review workload from false alarms)`);
