-- Migration 003: user accounts and login sessions.
--
-- Ownership chain after this migration:
--   users -> patients (people) -> reports -> results
-- Every row can be traced back to exactly one account, which is how each API
-- route checks "does this belong to the signed-in user?".

-- An account. It signs in EITHER with username + password OR with Google
-- (the unused columns stay NULL).
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(30)  NULL UNIQUE,   -- password accounts
  password_hash VARCHAR(100) NULL,          -- bcrypt hash, never the password itself
  google_sub    VARCHAR(64)  NULL UNIQUE,   -- Google's permanent user ID ("subject")
  email         VARCHAR(255) NULL,          -- from Google (verified by Google)
  display_name  VARCHAR(100) NOT NULL,
  avatar_url    VARCHAR(500) NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per signed-in browser. The browser holds a random token in a cookie;
-- we store only its SHA-256 hash, so a leaked database can't be used to log in.
CREATE TABLE IF NOT EXISTS sessions (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- People now belong to an account. Existing people have no account yet (NULL);
-- the first account created claims them (see routes/auth.js), so no data is lost.
ALTER TABLE patients ADD COLUMN user_id INT NULL AFTER id;
ALTER TABLE patients ADD CONSTRAINT fk_patients_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
