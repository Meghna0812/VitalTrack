// Normalization: turn "whatever the lab printed" into one consistent form.
//
// Lab A prints "Haemoglobin 135 g/L", Lab B prints "Hb 13.5 gm/dL".
// Both are the same test with the same value. To compare them over time we map:
//   name  -> canonical biomarker code (HGB)
//   value -> canonical unit (g/dL)
//
// Key design rule: if we are NOT sure, we do not guess. An unknown name or an
// unknown unit is sent to human review instead of being silently mis-mapped.
import { BIOMARKERS } from '../data/biomarkers.js';

// ---------- Names ----------

const STOPWORDS = new Set(['serum', 'plasma', 's', 'level', 'levels', 'blood']);

function words(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}
const compact = (ws) => ws.join('');
const withoutStopwords = (ws) => ws.filter((w) => !STOPWORDS.has(w));

// Build a lookup table alias-key -> biomarker once, at startup.
const byAlias = new Map();
function addAlias(key, bm) {
  if (!key) return;
  const existing = byAlias.get(key);
  if (existing && existing.code !== bm.code) {
    // Fail loudly while developing: two biomarkers must never share an alias.
    throw new Error(`Alias "${key}" maps to both ${existing.code} and ${bm.code}`);
  }
  byAlias.set(key, bm);
}
for (const bm of BIOMARKERS) {
  for (const alias of [...bm.aliases, bm.name, bm.code]) {
    const ws = words(alias);
    addAlias(compact(ws), bm);
    addAlias(compact(withoutStopwords(ws)), bm);
  }
}

export const getBiomarker = (code) => BIOMARKERS.find((b) => b.code === code) ?? null;

/** Map a printed test name ("S. Creatinine", "Hemoglobin (Hb)") to a catalog entry, or null. */
export function findBiomarker(rawName) {
  const name = String(rawName);
  const outside = name.replace(/\([^)]*\)/g, ' ');            // "Hemoglobin (Hb)" -> "Hemoglobin"
  const inside = (name.match(/\(([^)]*)\)/) ?? [])[1] ?? '';   // "Hemoglobin (Hb)" -> "Hb"
  for (const candidate of [name, outside, inside]) {
    const ws = words(candidate);
    const hit = byAlias.get(compact(ws)) ?? byAlias.get(compact(withoutStopwords(ws)));
    if (hit) return hit;
  }
  return null;
}

// ---------- Units ----------

/** Reduce unit spelling variations to one key: "x10³/µL", "10^3/uL" -> "103/ul". */
export function unitKey(unit) {
  if (unit == null) return '';
  return String(unit)
    .toLowerCase()
    .replace(/[µμ]/g, 'u')
    .replace(/mcg/g, 'ug')
    .replace(/³/g, '3').replace(/⁶/g, '6').replace(/⁹/g, '9').replace(/¹²/g, '12').replace(/²/g, '2')
    .replace(/\s+/g, '')
    .replace(/\^/g, '')
    .replace(/[×*]/g, 'x')
    .replace(/^x/, '')
    .replace(/cumm|cmm|mm3/g, 'ul')
    .replace(/cells/g, '')
    .replace(/lakhs?/g, 'lakh')
    .replace(/^gms?\//, 'g/');
}

// Pre-compute unit lookup tables using the same key function.
for (const bm of BIOMARKERS) {
  bm.unitMap = new Map(Object.entries(bm.units).map(([u, conv]) => [unitKey(u), conv]));
}

/** Convert a value to the biomarker's canonical unit. Returns undefined if the unit is unknown. */
export function convert(bm, value, unit) {
  if (value == null) return null;
  const conv = bm.unitMap.get(unitKey(unit));
  if (conv === undefined) return undefined;
  const out = typeof conv === 'function' ? conv(value) : value * conv;
  return Math.round(out * 1000) / 1000;
}

// ---------- Putting it together ----------

/**
 * Normalize one extracted result.
 * Input:  { name, value, unit, refLow, refHigh }   (as printed on the report)
 * Output: canonical values + a list of reasons a human should check it (empty = OK).
 */
export function normalizeResult(raw) {
  const reasons = [];
  const bm = findBiomarker(raw.name);
  if (!bm) {
    return { biomarkerCode: null, value: null, unit: null, refLow: null, refHigh: null, flag: null,
      reasons: [`unknown test name "${raw.name}"`] };
  }

  let unit = raw.unit;
  if (!unit || !String(unit).trim()) {
    unit = bm.unit;
    reasons.push(`no unit printed; assumed ${bm.unit}`);
  }
  const value = convert(bm, raw.value, unit);
  if (value === undefined) {
    return { biomarkerCode: bm.code, value: null, unit: null, refLow: null, refHigh: null, flag: null,
      reasons: [...reasons, `unit "${raw.unit}" cannot be converted to ${bm.unit}`] };
  }

  // Prefer the lab's own reference range (converted), fall back to the catalog default.
  const hasLabRange = raw.refLow != null || raw.refHigh != null;
  const refLow = hasLabRange ? convert(bm, raw.refLow, unit) : bm.range[0];
  const refHigh = hasLabRange ? convert(bm, raw.refHigh, unit) : bm.range[1];

  const [minOk, maxOk] = bm.plausible;
  if (value < minOk || value > maxOk) {
    reasons.push(`${value} ${bm.unit} is outside the physiologically plausible range (${minOk}–${maxOk})`);
  }

  let flag = 'normal';
  if (refLow != null && value < refLow) flag = 'low';
  else if (refHigh != null && value > refHigh) flag = 'high';

  return { biomarkerCode: bm.code, value, unit: bm.unit, refLow, refHigh, flag, reasons };
}
