// Brings the database up to date. Run with `npm run db:migrate`. Safe to run any number of times.
//
// 1. schema.sql creates the original tables (skipped if they already exist).
// 2. Every file in migrations/ runs once, in name order (002_, 003_, …).
//    The table `schema_migrations` remembers which ones already ran.
import { readFile, readdir } from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { config } from '../config.js';

const here = (p) => new URL(p, import.meta.url);
const conn = await mysql.createConnection({ ...config.mysql, multipleStatements: true });

await conn.query(await readFile(here('./schema.sql'), 'utf8'));
await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(255) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

const [rows] = await conn.query('SELECT name FROM schema_migrations');
const applied = new Set(rows.map((r) => r.name));
const files = (await readdir(here('./migrations/'))).filter((f) => f.endsWith('.sql')).sort();

for (const file of files) {
  if (applied.has(file)) continue;
  console.log(`Applying ${file}…`);
  await conn.query(await readFile(here(`./migrations/${file}`), 'utf8'));
  await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
}

console.log('Database is up to date.');
await conn.end();
