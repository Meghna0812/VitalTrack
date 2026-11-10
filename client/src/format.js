// Small display helpers used across the UI.

// Month names written out by hand: browsers' built-in short names differ ("Sep" vs "Sept"),
// and the design calls for exactly three letters everywhere, e.g. "21 Dec 2026".
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * MySQL gives us '2026-12-21' (DATE) or '2026-12-21 10:30:00' (TIMESTAMP) as strings.
 * We build the Date from the parts ourselves: `new Date('2026-12-21')` is read as UTC
 * midnight, which in some time zones shows as the PREVIOUS day.
 */
export function parseDate(value) {
  if (!value) return null;
  const [y, m, d] = String(value).slice(0, 10).split('-').map(Number);
  return y ? new Date(y, m - 1, d) : null;
}

/** '2026-12-21' -> '21 Dec 2026' */
export function formatDate(value) {
  const d = parseDate(value);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '—';
}

/** '2026-12-21' -> 'Dec'  (labels under the mini charts) */
export function formatMonth(value) {
  const d = parseDate(value);
  return d ? MONTHS[d.getMonth()] : '';
}

/** Date -> '2026-08-10' in LOCAL time (toISOString() would convert to UTC and can shift the day). */
export function toISODate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The date `n` months before today, e.g. monthsAgo(3) on 10 Nov 2026 -> 10 Aug 2026. */
export function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d;
}

/**
 * Capital first letter: "no unit printed" -> "No unit printed".
 * Used for messages that come from the backend (review reasons, errors), which are
 * written lower-case because they're also used in logs and tests.
 */
export function sentence(text) {
  if (!text) return text;
  const s = String(text);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Readable precision: 260, 91.9, 0.95 – instead of 91.876. */
export function formatValue(v) {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  return Number(v.toFixed(digits)).toLocaleString('en-GB');
}

/** "70 – 100", "< 200", "> 40" */
export function formatRange(low, high) {
  if (low != null && high != null) return `${formatValue(low)} – ${formatValue(high)}`;
  if (high != null) return `< ${formatValue(high)}`;
  if (low != null) return `> ${formatValue(low)}`;
  return '—';
}
