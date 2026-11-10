-- Migration 002: reports now belong to a person, and can have a description.
--
-- Why a migration instead of editing schema.sql?
-- Your database already has tables with data in them. `CREATE TABLE IF NOT EXISTS`
-- skips tables that exist, so new columns would never be added. A migration is a
-- small, numbered script that changes an EXISTING database step by step.

-- 1. A table of people. Each report belongs to exactly one person.
CREATE TABLE IF NOT EXISTS patients (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. New columns on reports.
-- (One change per ALTER statement: works on MySQL and on MySQL-compatible clouds like TiDB.)
ALTER TABLE reports ADD COLUMN patient_id INT NULL AFTER id;
ALTER TABLE reports ADD COLUMN description VARCHAR(500) NULL AFTER original_filename;

-- 3. Reports uploaded before this change have no person yet.
--    If there are any, create one person and give them those reports.
INSERT INTO patients (name)
  SELECT 'My reports' FROM DUAL WHERE EXISTS (SELECT 1 FROM reports);
UPDATE reports SET patient_id = (SELECT MIN(id) FROM patients) WHERE patient_id IS NULL;

-- 4. Now every report has a person, so make it required and link it.
--    ON DELETE CASCADE: deleting a person deletes their reports (and results).
ALTER TABLE reports MODIFY patient_id INT NOT NULL;
ALTER TABLE reports ADD CONSTRAINT fk_reports_patient FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE;
