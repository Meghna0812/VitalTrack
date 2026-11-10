-- VitalTrack database schema.
-- Two tables: one row per uploaded report, many result rows per report.

CREATE TABLE IF NOT EXISTS reports (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  original_filename VARCHAR(255) NOT NULL,
  file_path         VARCHAR(500) NOT NULL,
  mime_type         VARCHAR(100) NOT NULL,
  -- Lifecycle: queued -> processing -> needs_review | done   (or failed)
  status            ENUM('queued','processing','needs_review','done','failed') NOT NULL DEFAULT 'queued',
  report_date       DATE NULL,           -- sample collection date read from the report
  redacted_text     MEDIUMTEXT NULL,     -- only the PII-free text is stored
  redaction_counts  JSON NULL,           -- e.g. {"NAME":2,"PHONE":1}
  error             TEXT NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS results (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  report_id      INT NOT NULL,
  -- What the lab printed, exactly as the LLM read it
  raw_name       VARCHAR(255) NOT NULL,
  raw_value      DOUBLE NOT NULL,
  raw_unit       VARCHAR(50) NULL,
  -- Normalized version: canonical biomarker code + canonical unit
  biomarker_code VARCHAR(20) NULL,       -- NULL = name not recognised
  value          DOUBLE NULL,            -- NULL = unit could not be converted
  unit           VARCHAR(50) NULL,
  ref_low        DOUBLE NULL,
  ref_high       DOUBLE NULL,
  flag           ENUM('low','normal','high') NULL,
  -- Quality control
  confidence     DOUBLE NOT NULL,
  source_text    TEXT NULL,
  needs_review   BOOLEAN NOT NULL DEFAULT FALSE,
  review_reasons JSON NULL,
  reviewed       BOOLEAN NOT NULL DEFAULT FALSE,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  INDEX idx_results_biomarker (biomarker_code)
);
