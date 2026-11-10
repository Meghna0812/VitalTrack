// A connection *pool* keeps a few MySQL connections open and reuses them.
// Opening a new connection per request is slow; a pool avoids that.
import mysql from 'mysql2/promise';
import { config } from '../config.js';

export const pool = mysql.createPool({
  ...config.mysql,
  connectionLimit: 10,
  dateStrings: true, // return DATE columns as 'YYYY-MM-DD' strings, not JS Dates (avoids timezone shifts)
});
