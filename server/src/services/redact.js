// PII redaction: remove personally identifiable information BEFORE text leaves our server.
//
// The LLM only needs the test results. It does not need the patient's name, phone,
// address or ID numbers, so we replace those with placeholders like [NAME].
//
// Three layers:
//   1. Labelled fields   "Patient Name: Rahul Verma"  -> "Patient Name: [NAME]"
//   2. Patterns          emails, phone numbers, Aadhaar, PAN, honorific + name ("Mr. Rahul Verma")
//   3. A final check     if anything that looks like PII is still there, refuse to send (fail closed)

// Label -> placeholder type. The value after "Label:" (up to 2+ spaces, a tab or end of line) is redacted.
const LABELS = [
  ['NAME', String.raw`(?<!test\s)(?:patient(?:'s)?\s*name|pt\.?\s*name|patient|name)`],
  ['DOCTOR', String.raw`(?:ref(?:erred)?\.?\s*by|referring\s*(?:doctor|physician)|consultant|doctor)`],
  ['ID', String.raw`(?:uhid|mrn|patient\s*id|pid|sample\s*id|lab\s*(?:no|id)|reg(?:istration)?\.?\s*(?:no|id)|barcode|accession\s*(?:no|id)|visit\s*(?:no|id))\.?`],
  ['DOB', String.raw`(?:dob|d\.o\.b|date\s*of\s*birth)`],
  ['ADDRESS', String.raw`(?:address|addr)`],
  ['PHONE', String.raw`(?:mobile|phone|contact|tel)(?:\s*no)?\.?`],
  ['EMAIL', String.raw`e-?mail`],
];
const LABEL_RULES = LABELS.map(([type, label]) => ({
  type,
  re: new RegExp(String.raw`(\b${label}\s*[:\-]\s*)(.+?)(?=\s{2,}|\t|$)`, 'gim'),
}));

// Patterns are deliberately strict: a loose phone regex would also eat lab values like "250000".
const PATTERNS = [
  { type: 'EMAIL', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { type: 'AADHAAR', re: /\b\d{4}[ -]\d{4}[ -]\d{4}\b/g },
  { type: 'PAN', re: /\b[A-Z]{5}\d{4}[A-Z]\b/g },
  { type: 'PHONE', re: /(?:\+91[\s-]?|\b0)?\b[6-9]\d{4}[\s-]?\d{5}\b/g },        // Indian mobile
  { type: 'PHONE', re: /\+\d{1,3}[\s-]\(?\d{2,4}\)?[\s-]\d{3,4}[\s-]?\d{3,4}\b/g }, // international with +
  { type: 'PHONE', re: /\(\d{3}\)\s?\d{3}-\d{4}\b/g },                              // (555) 123-4567
  { type: 'NAME', re: /\b(?:Mr|Mrs|Ms|Miss|Master|Baby|Dr)\.?\s+[A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z.'-]*){0,3}/g },
];

// Used for the final safety check.
const LEAK_CHECKS = PATTERNS.filter((p) => ['EMAIL', 'AADHAAR', 'PAN', 'PHONE'].includes(p.type));

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @param {string} text            raw report text
 * @param {{knownNames?: string[]}} opts  names we know belong to the patient (redacted wherever they appear)
 * @returns {{text: string, counts: Record<string, number>}}
 */
export function redactPII(text, { knownNames = [] } = {}) {
  const counts = {};
  const bump = (type) => { counts[type] = (counts[type] ?? 0) + 1; };
  let out = text;

  for (const { type, re } of LABEL_RULES) {
    out = out.replace(re, (_m, label, value) => {
      if (/^\[[A-Z]+\]$/.test(value.trim())) return label + value; // already redacted
      bump(type);
      return `${label}[${type}]`;
    });
  }

  for (const { type, re } of PATTERNS) {
    out = out.replace(re, () => { bump(type); return `[${type}]`; });
  }

  for (const name of knownNames) {
    // Full name, then each part (first/last name). Parts under 3 letters are skipped:
    // redacting "Al" or "Jo" everywhere would also hit ordinary words and abbreviations.
    const parts = [name.trim(), ...name.trim().split(/\s+/)].filter((p) => p.length >= 3);
    for (const part of parts) {
      out = out.replace(new RegExp(`\\b${escapeRegex(part)}\\b`, 'gi'), () => { bump('NAME'); return '[NAME]'; });
    }
  }

  return { text: out, counts };
}

/** Throws if text still contains something that looks like PII. Call this right before the LLM call. */
export function assertNoPII(text) {
  for (const { type, re } of LEAK_CHECKS) {
    re.lastIndex = 0;
    if (re.test(text)) {
      throw new Error(`PII check failed: text still contains a possible ${type}; refusing to send to LLM`);
    }
  }
}
