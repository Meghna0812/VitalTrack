// All SQL lives here. Routes and the worker call these functions instead of writing SQL.
// Note the `?` placeholders: mysql2 escapes the values, which prevents SQL injection.
import { pool } from './pool.js';

// ---------- Ownership checks ----------
// Every "...ForUser" function adds `p.user_id = ?` to the query, so a row that belongs
// to another account simply isn't found. Routes then answer 404 – they don't even reveal
// that the row exists. Without these checks, changing the ID in a URL would show someone
// else's reports (a classic bug called IDOR: Insecure Direct Object Reference).

export async function getPatientForUser(id, userId) {
  const [rows] = await pool.query('SELECT * FROM patients p WHERE p.id = ? AND p.user_id = ?', [id, userId]);
  return rows[0] ?? null;
}

export async function getReportForUser(id, userId) {
  const [rows] = await pool.query(
    `SELECT r.*, p.name AS patient_name FROM reports r JOIN patients p ON p.id = r.patient_id
     WHERE r.id = ? AND p.user_id = ?`, [id, userId]);
  return rows[0] ?? null;
}

export async function getResultForUser(id, userId) {
  const [rows] = await pool.query(
    `SELECT x.* FROM results x JOIN reports r ON r.id = x.report_id JOIN patients p ON p.id = r.patient_id
     WHERE x.id = ? AND p.user_id = ?`, [id, userId]);
  return rows[0] ?? null;
}

// ---------- People ----------

export async function listPatients(userId) {
  const [rows] = await pool.query(`
    SELECT p.id, p.name, p.created_at, COUNT(r.id) AS report_count
    FROM patients p LEFT JOIN reports r ON r.patient_id = p.id
    WHERE p.user_id = ?
    GROUP BY p.id ORDER BY p.created_at`, [userId]);
  return rows;
}

export async function getPatient(id) {
  const [rows] = await pool.query('SELECT * FROM patients WHERE id = ?', [id]);
  return rows[0] ?? null;
}

export async function createPatient(userId, name) {
  const [r] = await pool.query('INSERT INTO patients (user_id, name) VALUES (?, ?)', [userId, name]);
  return getPatient(r.insertId);
}

/** Remove a person. Their reports and results are deleted too (ON DELETE CASCADE). Returns their file paths. */
export async function deletePatient(id) {
  const [files] = await pool.query('SELECT file_path FROM reports WHERE patient_id = ?', [id]);
  await pool.query('DELETE FROM patients WHERE id = ?', [id]);
  return files.map((f) => f.file_path);
}

// ---------- Reports ----------

export async function createReport({ patientId, originalFilename, filePath, mimeType }) {
  const [r] = await pool.query(
    'INSERT INTO reports (patient_id, original_filename, file_path, mime_type) VALUES (?, ?, ?, ?)',
    [patientId, originalFilename, filePath, mimeType],
  );
  return r.insertId;
}

/** A report plus its owner's name (the worker uses the name to redact it from the text). */
export async function getReport(id) {
  const [rows] = await pool.query(
    'SELECT r.*, p.name AS patient_name FROM reports r JOIN patients p ON p.id = r.patient_id WHERE r.id = ?', [id]);
  return rows[0] ?? null;
}

/** Newest report first – sorted by the date printed on the report, falling back to upload time. */
export async function listReports(patientId) {
  const [rows] = await pool.query(`
    SELECT r.id, r.original_filename, r.description, r.status, r.report_date, r.error, r.created_at,
           COUNT(x.id) AS result_count,
           COALESCE(SUM(x.needs_review), 0) AS pending_review
    FROM reports r LEFT JOIN results x ON x.report_id = r.id
    WHERE r.patient_id = ?
    GROUP BY r.id ORDER BY COALESCE(r.report_date, DATE(r.created_at)) DESC, r.id DESC`, [patientId]);
  return rows;
}

/** Reports the worker hasn't finished yet – re-queued when the worker starts. */
export async function listUnfinishedReportIds() {
  const [rows] = await pool.query("SELECT id FROM reports WHERE status IN ('queued','processing') ORDER BY id");
  return rows.map((r) => r.id);
}

export async function updateDescription(id, description) {
  await pool.query('UPDATE reports SET description = ? WHERE id = ?', [description, id]);
}

export async function deleteReport(id) {
  await pool.query('DELETE FROM reports WHERE id = ?', [id]); // results go too (ON DELETE CASCADE)
}

export async function setStatus(id, status, error = null) {
  await pool.query('UPDATE reports SET status = ?, error = ? WHERE id = ?', [status, error, id]);
}

export async function getResults(reportId) {
  const [rows] = await pool.query('SELECT * FROM results WHERE report_id = ? ORDER BY id', [reportId]);
  return rows;
}

export async function getResult(id) {
  const [rows] = await pool.query('SELECT * FROM results WHERE id = ?', [id]);
  return rows[0] ?? null;
}

/** Save the pipeline output. A transaction makes it all-or-nothing: no half-saved reports. */
export async function saveExtraction(reportId, { redactedText, redactionCounts, reportDate, results }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('DELETE FROM results WHERE report_id = ?', [reportId]); // safe to re-run on retry
    for (const r of results) {
      await conn.query(
        `INSERT INTO results (report_id, raw_name, raw_value, raw_unit, biomarker_code, value, unit,
           ref_low, ref_high, flag, confidence, source_text, needs_review, review_reasons)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [reportId, r.rawName, r.rawValue, r.rawUnit, r.biomarkerCode, r.value, r.unit,
          r.refLow, r.refHigh, r.flag, r.confidence, r.sourceText, r.needsReview, JSON.stringify(r.reviewReasons)],
      );
    }
    const status = results.some((r) => r.needsReview) ? 'needs_review' : 'done';
    await conn.query(
      'UPDATE reports SET status = ?, report_date = ?, redacted_text = ?, redaction_counts = ?, error = NULL WHERE id = ?',
      [status, reportDate, redactedText, JSON.stringify(redactionCounts), reportId],
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

export async function updateReviewedResult(id, fields) {
  await pool.query(
    `UPDATE results SET biomarker_code = ?, value = ?, unit = ?, ref_low = ?, ref_high = ?, flag = ?,
       needs_review = FALSE, reviewed = TRUE WHERE id = ?`,
    [fields.biomarkerCode, fields.value, fields.unit, fields.refLow, fields.refHigh, fields.flag, id],
  );
}

export async function deleteResult(id) {
  await pool.query('DELETE FROM results WHERE id = ?', [id]);
}

/** When the last flagged result of a report is resolved, the report becomes 'done'. */
export async function refreshReportStatus(reportId) {
  const [[{ pending }]] = await pool.query(
    'SELECT COALESCE(SUM(needs_review), 0) AS pending FROM results WHERE report_id = ?', [reportId]);
  await pool.query(
    `UPDATE reports SET status = ? WHERE id = ? AND status IN ('needs_review','done')`,
    [Number(pending) > 0 ? 'needs_review' : 'done', reportId]);
}

/**
 * One person's trusted (not awaiting review) results, oldest first – input for trend analysis.
 * `from` ('YYYY-MM-DD', optional) keeps only results on or after that date (e.g. "last 3 months").
 */
export async function getTrustedSeries(patientId, from = null) {
  const [rows] = await pool.query(`
    SELECT x.biomarker_code, x.value, x.ref_low, x.ref_high, r.id AS report_id,
           COALESCE(r.report_date, DATE(r.created_at)) AS date
    FROM results x JOIN reports r ON r.id = x.report_id
    WHERE r.patient_id = ? AND x.needs_review = FALSE AND x.biomarker_code IS NOT NULL AND x.value IS NOT NULL
      AND (? IS NULL OR COALESCE(r.report_date, DATE(r.created_at)) >= ?)
    ORDER BY date, r.id`, [patientId, from, from]);
  return rows;
}
