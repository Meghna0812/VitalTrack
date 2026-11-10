// The extraction pipeline, as one function with no database or queue code in it.
// Keeping it "pure" means the worker, the tests and the evaluation script all run
// exactly the same logic.
//
//   raw text -> redact PII -> leak check -> LLM -> schema validation (inside llm.js)
//            -> normalize names/units -> quality checks -> results (+ review flags)
import { config } from '../config.js';
import { redactPII, assertNoPII } from './redact.js';
import { extractWithLLM } from './llm.js';
import { normalizeResult } from './normalize.js';

/** Every number that appears in the text. "2,50,000" -> 250000. */
export function numbersIn(text) {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => Number(n.replace(/,/g, '')));
}

export async function processText(rawText, { llm = extractWithLLM, knownNames = [], threshold = config.confidenceThreshold } = {}) {
  const { text: redactedText, counts } = redactPII(rawText, { knownNames });
  assertNoPII(redactedText); // fail closed: throws instead of sending possible PII

  const extraction = await llm(redactedText);
  const numbers = numbersIn(redactedText);

  const results = extraction.biomarkers.map((b) => {
    const n = normalizeResult(b);
    const reasons = [...n.reasons];
    if (b.confidence < threshold) reasons.push(`model confidence ${b.confidence} is below ${threshold}`);
    // Grounding check: the number must literally exist in the report. Catches hallucinated values.
    if (!numbers.some((x) => Math.abs(x - b.value) < 1e-9)) reasons.push(`value ${b.value} does not appear in the report text`);
    return {
      rawName: b.name, rawValue: b.value, rawUnit: b.unit,
      biomarkerCode: n.biomarkerCode, value: n.value, unit: n.unit,
      refLow: n.refLow, refHigh: n.refHigh, flag: n.flag,
      confidence: b.confidence, sourceText: b.sourceText,
      reviewReasons: reasons,
    };
  });

  // The same biomarker twice in one report means one of them is probably mis-mapped.
  const seen = new Map();
  for (const r of results) if (r.biomarkerCode) seen.set(r.biomarkerCode, (seen.get(r.biomarkerCode) ?? 0) + 1);
  for (const r of results) {
    if (r.biomarkerCode && seen.get(r.biomarkerCode) > 1) r.reviewReasons.push(`${r.biomarkerCode} appears more than once in this report`);
    r.needsReview = r.reviewReasons.length > 0;
  }

  return { redactedText, redactionCounts: counts, reportDate: extraction.reportDate, results };
}
