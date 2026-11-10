// Schema validation with Zod.
//
// An LLM returns *text*. Even when asked for JSON it can return a string where a
// number belongs, forget a field, or invent a confidence of 7. Zod checks the
// exact shape and types; anything that doesn't match is rejected, never stored.
import { z } from 'zod';

// Accept "13.5" as well as 13.5, but reject "13.5 g/dL" or "high".
const toNumber = (v) => (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : v);
const number = z.preprocess(toNumber, z.number().finite());
const nullableNumber = z.preprocess((v) => (v === '' || v === undefined ? null : v), number.nullable());

export const BiomarkerSchema = z.object({
  name: z.string().min(1),
  value: number,
  unit: z.string().nullable(),
  refLow: nullableNumber,
  refHigh: nullableNumber,
  confidence: z.preprocess(toNumber, z.number().min(0).max(1)),
  sourceText: z.string(),
});

export const ExtractionSchema = z.object({
  reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  biomarkers: z.array(BiomarkerSchema),
});
